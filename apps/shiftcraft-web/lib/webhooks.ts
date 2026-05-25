import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  forTenant,
  scWebhookDeliveries,
  scWebhookSubscriptions,
} from "@tracey/db";

// ─── Recognised events (AUDIT.md #10) ───────────────────────────────
//
// Adding a new event here is the entire wire-up cost: subscriptions
// can target it immediately, and the emit helper accepts the new
// string. Receivers see the same string on the X-Webhook-Event
// header so they can branch off it.

export const WEBHOOK_EVENTS = [
  "timesheet.approved",
  "employee.created",
  "shift.published",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isKnownWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

// ─── Secret generation + signing ────────────────────────────────────
//
// Secrets are 32 random bytes hex-encoded (64 chars). The DB
// check-constraint enforces ≥16 chars; this generator is well over
// that. Receivers verify the signature with the same algorithm:
//
//   const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
//   if (`sha256=${sig}` !== header) reject();

export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// Constant-time verification for parity with receivers that don't
// know about timingSafeEqual. Internal — exported for the round-trip
// tests at tests/webhook-sign.test.ts.
export function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
): boolean {
  const expected = Buffer.from(signWebhookBody(secret, body));
  const got = Buffer.from(header);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

// ─── Emit + delivery ────────────────────────────────────────────────
//
// emitWebhook(tenantId, event, payload):
//   1. Look up active subscriptions for (tenant, event).
//   2. For each, insert a sc_webhook_deliveries row in 'pending'.
//   3. POST the payload with the signature header.
//   4. Update the delivery row to succeeded / failed and bump the
//      subscription's last_success_at or last_failure_at.
//
// Fire-and-forget from the caller's perspective: deliveries are
// awaited concurrently but exceptions are swallowed so a broken
// receiver doesn't break the surrounding business action. The
// admin can retry from /app/admin/webhooks.

const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_EXCERPT_MAX = 1000;

export interface EmitOptions {
  /** Optional override for the request timeout (tests use a short value). */
  timeoutMs?: number;
  /** Inject a custom fetch — tests pass a mock; prod uses globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export async function emitWebhook(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<void> {
  // Snapshot the active subscriptions for this event. Done in a
  // single query so the caller's hot path doesn't pay N round-trips.
  const subscriptions = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scWebhookSubscriptions.id,
        url: scWebhookSubscriptions.url,
        secret: scWebhookSubscriptions.secret,
      })
      .from(scWebhookSubscriptions)
      .where(
        and(
          eq(scWebhookSubscriptions.traceyTenantId, tenantId),
          eq(scWebhookSubscriptions.event, event),
          eq(scWebhookSubscriptions.isActive, true),
        ),
      ),
  );
  if (subscriptions.length === 0) return;

  await Promise.allSettled(
    subscriptions.map((s) =>
      deliverOnce(tenantId, s.id, event, s.url, s.secret, payload, opts),
    ),
  );
}

interface DeliveryResult {
  status: "succeeded" | "failed";
  responseStatus: number | null;
  responseBodyExcerpt: string | null;
  lastError: string | null;
}

// Performs the actual HTTP POST + persistence. Returns the outcome so
// the admin "Retry" action can reuse the same code path without
// duplicating the side effects.
async function deliverOnce(
  tenantId: string,
  subscriptionId: string,
  event: string,
  url: string,
  secret: string,
  payload: Record<string, unknown>,
  opts: EmitOptions,
): Promise<DeliveryResult> {
  const body = JSON.stringify({ event, data: payload, sent_at: new Date().toISOString() });
  const signature = signWebhookBody(secret, body);

  // Insert the pending delivery row first so a network hang still
  // leaves a recoverable trail. updated_at advances when the
  // attempt resolves below.
  const [delivery] = await forTenant(tenantId).run((tx) =>
    tx
      .insert(scWebhookDeliveries)
      .values({
        traceyTenantId: tenantId,
        subscriptionId,
        event,
        payload: payload as Record<string, unknown>,
        status: "pending",
        attemptCount: 1,
        requestSentAt: new Date(),
      })
      .returning({ id: scWebhookDeliveries.id }),
  );
  if (!delivery) {
    // Insert failed for some weird reason. Bail without throwing —
    // the action's primary commit already happened.
    return {
      status: "failed",
      responseStatus: null,
      responseBodyExcerpt: null,
      lastError: "Failed to record delivery",
    };
  }

  const result = await attemptHttp(url, body, signature, event, opts);
  await persistResult(tenantId, subscriptionId, delivery.id, result);
  return result;
}

async function attemptHttp(
  url: string,
  body: string,
  signature: string,
  event: string,
  opts: EmitOptions,
): Promise<DeliveryResult> {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-event": event,
        "x-webhook-signature": signature,
        "user-agent": "ShiftCraft-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    const text = await safeReadText(res);
    const excerpt =
      text == null
        ? null
        : text.length > RESPONSE_EXCERPT_MAX
          ? text.slice(0, RESPONSE_EXCERPT_MAX)
          : text;
    if (res.ok) {
      return {
        status: "succeeded",
        responseStatus: res.status,
        responseBodyExcerpt: excerpt,
        lastError: null,
      };
    }
    return {
      status: "failed",
      responseStatus: res.status,
      responseBodyExcerpt: excerpt,
      lastError: `HTTP ${res.status}`,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : err.message
        : "Unknown error";
    return {
      status: "failed",
      responseStatus: null,
      responseBodyExcerpt: null,
      lastError: message,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeReadText(res: Response): Promise<string | null> {
  try {
    return await res.text();
  } catch {
    return null;
  }
}

async function persistResult(
  tenantId: string,
  subscriptionId: string,
  deliveryId: string,
  result: DeliveryResult,
): Promise<void> {
  const now = new Date();
  await forTenant(tenantId).run(async (tx) => {
    await tx
      .update(scWebhookDeliveries)
      .set({
        status: result.status,
        responseStatus: result.responseStatus,
        responseBodyExcerpt: result.responseBodyExcerpt,
        lastError: result.lastError,
        updatedAt: now,
      })
      .where(eq(scWebhookDeliveries.id, deliveryId));
    await tx
      .update(scWebhookSubscriptions)
      .set(
        result.status === "succeeded"
          ? { lastSuccessAt: now, updatedAt: now }
          : { lastFailureAt: now, updatedAt: now },
      )
      .where(eq(scWebhookSubscriptions.id, subscriptionId));
  });
}

// ─── Retry (admin-triggered) ────────────────────────────────────────
//
// Re-fires a single existing delivery row using the subscription's
// CURRENT secret + URL (not the historical values — if the operator
// rotated the secret, the retry uses the new one, which is usually
// what they want). Bumps attempt_count and overwrites the result
// columns. Doesn't insert a new delivery row to keep the log
// uncluttered.

export async function retryWebhookDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<DeliveryResult> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scWebhookDeliveries.id,
        subscriptionId: scWebhookDeliveries.subscriptionId,
        event: scWebhookDeliveries.event,
        payload: scWebhookDeliveries.payload,
        attemptCount: scWebhookDeliveries.attemptCount,
        url: scWebhookSubscriptions.url,
        secret: scWebhookSubscriptions.secret,
        isActive: scWebhookSubscriptions.isActive,
      })
      .from(scWebhookDeliveries)
      .innerJoin(
        scWebhookSubscriptions,
        eq(scWebhookSubscriptions.id, scWebhookDeliveries.subscriptionId),
      )
      .where(
        and(
          eq(scWebhookDeliveries.id, deliveryId),
          eq(scWebhookDeliveries.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) {
    return {
      status: "failed",
      responseStatus: null,
      responseBodyExcerpt: null,
      lastError: "Delivery not found",
    };
  }
  if (!row.isActive) {
    return {
      status: "failed",
      responseStatus: null,
      responseBodyExcerpt: null,
      lastError: "Subscription is paused",
    };
  }

  const payloadObj = (row.payload ?? {}) as Record<string, unknown>;
  const body = JSON.stringify({
    event: row.event,
    data: payloadObj,
    sent_at: new Date().toISOString(),
  });
  const signature = signWebhookBody(row.secret, body);
  const result = await attemptHttp(row.url, body, signature, row.event, {});

  await forTenant(tenantId).run(async (tx) => {
    await tx
      .update(scWebhookDeliveries)
      .set({
        status: result.status,
        responseStatus: result.responseStatus,
        responseBodyExcerpt: result.responseBodyExcerpt,
        lastError: result.lastError,
        attemptCount: row.attemptCount + 1,
        requestSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scWebhookDeliveries.id, deliveryId));
    await tx
      .update(scWebhookSubscriptions)
      .set(
        result.status === "succeeded"
          ? { lastSuccessAt: new Date(), updatedAt: new Date() }
          : { lastFailureAt: new Date(), updatedAt: new Date() },
      )
      .where(eq(scWebhookSubscriptions.id, row.subscriptionId));
  });

  return result;
}
