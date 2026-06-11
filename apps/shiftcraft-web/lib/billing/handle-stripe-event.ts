import "server-only";
import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db, tenantSubscriptions, processedStripeEvents } from "@tracey/db";
import { planFromPrice, statusFromStripe } from "./plan";
import { logAuditEvent } from "~/lib/audit";

const APP = "shiftcraft" as const;

export interface HandleResult {
  status: "processed" | "duplicate" | "ignored" | "missing_tenant";
  tenantId?: string;
  type: string;
}

// Normalise a Stripe reference (session.customer, sub.customer,
// invoice.subscription, …) to its bare id. Stripe delivers these as either a
// string or the expanded object depending on API version; a strict
// `typeof === "string"` check silently drops the expanded shape. See
// [[feedback_stripe_api_version_drift]].
function idOf(
  ref: string | { id?: unknown } | null | undefined,
): string | null {
  if (typeof ref === "string") return ref;
  if (ref && typeof ref === "object" && "id" in ref && typeof ref.id === "string") {
    return ref.id;
  }
  return null;
}

// ShiftCraft and lms-web share one Stripe account, so EVERY endpoint receives
// every event of the subscribed types. We tag ShiftCraft checkouts with
// metadata.app="shiftcraft" (on both the session and the subscription) and
// only act on those — lms subscriptions (no app, or app="lms") fall through to
// "ignored". The tenant is resolved from metadata.tenant_id, never from the
// shared customer id (which would be ambiguous across apps).
function isShiftcraft(meta: Stripe.Metadata | null | undefined): boolean {
  return meta?.app === APP;
}

/**
 * Apply a verified Stripe webhook event to the tenant's ShiftCraft
 * subscription row.
 *
 * Idempotent: the dedup key is namespaced `shiftcraft:<event.id>` because the
 * `processed_stripe_events` table is shared with lms-web (bare event-id PK) —
 * without the prefix, whichever service processed an event first would block
 * the other. Recorded first, then applied.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
): Promise<HandleResult> {
  const inserted = await db
    .insert(processedStripeEvents)
    .values({ eventId: `${APP}:${event.id}`, type: event.type })
    .onConflictDoNothing({ target: processedStripeEvents.eventId })
    .returning({ id: processedStripeEvents.eventId });
  if (inserted.length === 0) {
    return { status: "duplicate", type: event.type };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!isShiftcraft(session.metadata)) {
        return { status: "ignored", type: event.type };
      }
      const tenantId = session.client_reference_id;
      if (!tenantId) return { status: "missing_tenant", type: event.type };
      const result = await db
        .update(tenantSubscriptions)
        .set({
          stripeCustomerId: idOf(session.customer),
          stripeSubscriptionId: idOf(session.subscription),
          status: "active",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantSubscriptions.tenantId, tenantId),
            eq(tenantSubscriptions.app, APP),
          ),
        )
        .returning({ id: tenantSubscriptions.id });
      if (result.length === 0) {
        return { status: "missing_tenant", type: event.type };
      }
      await logAuditEvent({
        action: "shiftcraft.subscription.changed",
        targetKind: "tenant_subscription",
        targetId: tenantId,
        details: { stripe_event: event.type, status: "active" },
      });
      return { status: "processed", tenantId, type: event.type };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (!isShiftcraft(sub.metadata)) {
        return { status: "ignored", type: event.type };
      }
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) return { status: "missing_tenant", type: event.type };
      const item = sub.items.data[0];
      const plan = planFromPrice(item?.price);
      const seats = item?.quantity ?? 0;
      // current_period_end moved onto each SubscriptionItem in API version
      // 2026-04-22; read the item first, fall back to the (deprecated)
      // top-level field, then trial_end. null is acceptable (column nullable).
      const itemPeriodEnd = (
        item as { current_period_end?: number | null } | undefined
      )?.current_period_end;
      const subPeriodEnd = (sub as { current_period_end?: number | null })
        .current_period_end;
      const periodEndSec = itemPeriodEnd ?? subPeriodEnd ?? sub.trial_end ?? null;
      const currentPeriodEnd = periodEndSec
        ? new Date(periodEndSec * 1000)
        : null;
      const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      const canceledAt = sub.canceled_at
        ? new Date(sub.canceled_at * 1000)
        : null;
      const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const result = await db
        .update(tenantSubscriptions)
        .set({
          stripeCustomerId: idOf(sub.customer),
          stripeSubscriptionId: sub.id,
          plan,
          status: statusFromStripe(sub.status),
          currentPeriodEnd,
          cancelAtPeriodEnd,
          canceledAt,
          seatsPurchased: seats,
          ...(trialEndsAt ? { trialEndsAt } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantSubscriptions.tenantId, tenantId),
            eq(tenantSubscriptions.app, APP),
          ),
        )
        .returning({ id: tenantSubscriptions.id });
      if (result.length === 0) {
        return { status: "missing_tenant", type: event.type };
      }
      await logAuditEvent({
        action: "shiftcraft.subscription.changed",
        targetKind: "tenant_subscription",
        targetId: tenantId,
        details: {
          stripe_event: event.type,
          plan,
          status: statusFromStripe(sub.status),
          seats,
          cancel_at_period_end: cancelAtPeriodEnd,
        },
      });
      return { status: "processed", tenantId, type: event.type };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (!isShiftcraft(sub.metadata)) {
        return { status: "ignored", type: event.type };
      }
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) return { status: "missing_tenant", type: event.type };
      const canceledAt = sub.canceled_at
        ? new Date(sub.canceled_at * 1000)
        : new Date();
      await db
        .update(tenantSubscriptions)
        .set({
          status: "canceled",
          cancelAtPeriodEnd: false,
          canceledAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantSubscriptions.tenantId, tenantId),
            eq(tenantSubscriptions.app, APP),
          ),
        );
      await logAuditEvent({
        action: "shiftcraft.subscription.changed",
        targetKind: "tenant_subscription",
        targetId: tenantId,
        details: { stripe_event: event.type, status: "canceled" },
      });
      return { status: "processed", tenantId, type: event.type };
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      // Invoices don't carry our metadata; match the ShiftCraft row by its
      // stored subscription id. A non-ShiftCraft invoice matches no row and is
      // ignored — no need to inspect app metadata.
      const subId =
        idOf((invoice as { subscription?: string | { id?: unknown } }).subscription) ??
        idOf(
          (
            invoice as {
              parent?: { subscription_details?: { subscription?: string | { id?: unknown } } };
            }
          ).parent?.subscription_details?.subscription,
        );
      if (!subId) return { status: "ignored", type: event.type };
      const nextStatus =
        event.type === "invoice.paid" ? "active" : "past_due";
      const result = await db
        .update(tenantSubscriptions)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(
          and(
            eq(tenantSubscriptions.app, APP),
            eq(tenantSubscriptions.stripeSubscriptionId, subId),
          ),
        )
        .returning({ id: tenantSubscriptions.id, tenantId: tenantSubscriptions.tenantId });
      const updated = result[0];
      if (!updated) return { status: "ignored", type: event.type };
      await logAuditEvent({
        action: "shiftcraft.subscription.changed",
        targetKind: "tenant_subscription",
        targetId: updated.tenantId,
        details: { stripe_event: event.type, status: nextStatus },
      });
      return { status: "processed", tenantId: updated.tenantId, type: event.type };
    }

    default:
      return { status: "ignored", type: event.type };
  }
}
