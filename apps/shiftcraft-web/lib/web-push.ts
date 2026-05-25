import "server-only";
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { forTenant, scPushSubscriptions } from "@tracey/db";

// ─── VAPID setup (AUDIT.md #12) ─────────────────────────────────────
//
// Three env vars drive web push. Generate the keypair once with
// `pnpm tsx scripts/generate-vapid.ts` (see that file). The same key
// pair must be reused — rotating invalidates every existing browser
// subscription.
//
//   VAPID_PUBLIC_KEY       URL-safe base64 (no padding), 87 chars
//   VAPID_PRIVATE_KEY      URL-safe base64 (no padding), 43 chars
//   VAPID_SUBJECT          mailto:ops@yourdomain or https URL
//
// Push is silently disabled when any of these are missing — the app
// continues to function, just without browser notifications.

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT;

let isConfigured = false;
if (PUBLIC_KEY && PRIVATE_KEY && SUBJECT) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    isConfigured = true;
  } catch (err) {
    console.warn("[web-push] VAPID setup failed:", err);
  }
}

// Exposed so the client subscribe component can render only when
// the server has push wired up.
export function isWebPushConfigured(): boolean {
  return isConfigured;
}

// Public key for the browser subscription request. The PushManager
// needs the raw bytes; the client converts via urlBase64ToUint8Array.
export function getVapidPublicKey(): string | null {
  return PUBLIC_KEY ?? null;
}

// ─── Payload shape ──────────────────────────────────────────────────
//
// Matches what sw.js reads. Keep small (< ~4KB) — providers reject
// larger payloads, and the encryption overhead grows with size.

export interface WebPushPayload {
  title: string;
  body?: string;
  actionUrl?: string;
  /** Used as the notification `tag` so duplicates collapse on the OS. */
  tag?: string;
  icon?: string;
  badge?: string;
}

// ─── Send to one user across all their browsers ─────────────────────
//
// Fan-out across every subscription row for (tenant, user). 410 Gone
// + 404 deletes the row so the table stays pruned. Other failures
// are logged and swallowed — push is best-effort; in-app
// notifications remain the source of truth.

export async function sendPushToUser(
  tenantId: string,
  userId: string,
  payload: WebPushPayload,
): Promise<{ sent: number; pruned: number; failed: number }> {
  if (!isConfigured) return { sent: 0, pruned: 0, failed: 0 };

  const subs = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scPushSubscriptions.id,
        endpoint: scPushSubscriptions.endpoint,
        p256dh: scPushSubscriptions.p256dh,
        auth: scPushSubscriptions.auth,
      })
      .from(scPushSubscriptions)
      .where(
        and(
          eq(scPushSubscriptions.traceyTenantId, tenantId),
          eq(scPushSubscriptions.appUserId, userId),
        ),
      ),
  );
  if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;
  let failed = 0;
  const succeededIds: string[] = [];
  const prunedIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
        );
        sent += 1;
        succeededIds.push(s.id);
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (status === 404 || status === 410) {
          pruned += 1;
          prunedIds.push(s.id);
        } else {
          failed += 1;
          console.warn(
            "[web-push] delivery failed",
            { endpoint: s.endpoint.slice(0, 60), status },
            err,
          );
        }
      }
    }),
  );

  if (prunedIds.length > 0 || succeededIds.length > 0) {
    await forTenant(tenantId).run(async (tx) => {
      if (prunedIds.length > 0) {
        for (const id of prunedIds) {
          await tx
            .delete(scPushSubscriptions)
            .where(eq(scPushSubscriptions.id, id));
        }
      }
      if (succeededIds.length > 0) {
        const now = new Date();
        for (const id of succeededIds) {
          await tx
            .update(scPushSubscriptions)
            .set({ lastSuccessAt: now, updatedAt: now })
            .where(eq(scPushSubscriptions.id, id));
        }
      }
    });
  }

  return { sent, pruned, failed };
}
