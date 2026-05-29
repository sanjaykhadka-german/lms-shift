import "server-only";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import {
  db,
  tenants,
  processedStripeEvents,
  type Tenant,
} from "@tracey/db";
import { planFromPrice, statusFromStripe } from "./plan";
import { logAuditEvent } from "~/lib/audit";

export interface HandleResult {
  status: "processed" | "duplicate" | "ignored" | "missing_tenant";
  tenantId?: Tenant["id"];
  type: string;
}

// Normalises a Stripe reference field (e.g. session.customer, sub.customer,
// invoice.customer, session.subscription) to its bare ID. Stripe webhook
// payloads can deliver these as either the bare ID string OR the expanded
// object — the API version determines which, and `2026-04-22.preview` ships
// them expanded on Checkout.Session in particular. A strict
// `typeof === "string"` check silently drops the expanded shape and writes
// nulls into the DB, so do this once for every Stripe reference read.
function idOf(
  ref: string | { id?: unknown } | null | undefined,
): string | null {
  if (typeof ref === "string") return ref;
  if (
    ref &&
    typeof ref === "object" &&
    "id" in ref &&
    typeof ref.id === "string"
  ) {
    return ref.id;
  }
  return null;
}

/**
 * Apply a verified Stripe webhook event to the tenant table.
 *
 * Idempotent: an `event.id` already present in `processed_stripe_events` is a
 * no-op and returns `duplicate`. Otherwise the row is recorded *first* (so a
 * subsequent failure doesn't double-process), then the event is applied.
 *
 * Pure-ish: takes the parsed event in, mutates rows. No HTTP. Easy to test.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<HandleResult> {
  const inserted = await db
    .insert(processedStripeEvents)
    .values({ eventId: event.id, type: event.type })
    .onConflictDoNothing({ target: processedStripeEvents.eventId })
    .returning({ id: processedStripeEvents.eventId });
  if (inserted.length === 0) {
    return { status: "duplicate", type: event.type };
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.client_reference_id;
      if (!tenantId) return { status: "missing_tenant", type: event.type };
      await db
        .update(tenants)
        .set({
          stripeCustomerId: idOf(session.customer),
          stripeSubscriptionId: idOf(session.subscription),
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
      await logAuditEvent({
        tenantId,
        action: "subscription.changed",
        targetKind: "tenant",
        targetId: tenantId,
        details: { stripe_event: event.type, status: "active" },
      });
      return { status: "processed", tenantId, type: event.type };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = idOf(sub.customer);
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const item = sub.items.data[0];
      const plan = planFromPrice(item?.price);
      const seats = item?.quantity ?? 0;
      // current_period_end moved from the Subscription onto each
      // SubscriptionItem in Stripe API version 2026-04-22.dahlia. The
      // stripe@17.7.0 TS types still declare it on Subscription, so cast
      // structurally and read from the item first, fall back to the
      // (deprecated) top-level field for older API versions still in use,
      // and finally fall back to trial_end so a still-in-trial subscription
      // always lands with a sane next-billing date. null is acceptable —
      // the column is nullable in the schema.
      const itemPeriodEnd = (item as { current_period_end?: number | null } | undefined)
        ?.current_period_end;
      const subPeriodEnd = (sub as { current_period_end?: number | null })
        .current_period_end;
      const periodEndSec = itemPeriodEnd ?? subPeriodEnd ?? sub.trial_end ?? null;
      const currentPeriodEnd = periodEndSec ? new Date(periodEndSec * 1000) : null;
      // Stripe reports a pending cancellation as `status=active` +
      // `cancel_at_period_end=true` until the period ends, then fires
      // `customer.subscription.deleted`. Mirror both flags so the dashboard
      // can warn before the grace window expires.
      const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
      const canceledAt = sub.canceled_at ? new Date(sub.canceled_at * 1000) : null;
      // Keep our trialEndsAt in lockstep with whatever Stripe is actually
      // enforcing. Without this, the local field would still point at the
      // original signup-trial deadline even after Subscribe was clicked, and
      // /app/billing would falsely render "Your free trial ended" while the
      // Stripe-side trial was still running. If Stripe has no trial_end on
      // the subscription, we leave the existing value alone — Stripe keeps
      // trial_end set after expiry, so once we sync we stay in sync.
      const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
      const result = await db
        .update(tenants)
        .set({
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
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (!updated) return { status: "missing_tenant", type: event.type };
      await logAuditEvent({
        tenantId: updated.id,
        action: "subscription.changed",
        targetKind: "tenant",
        targetId: updated.id,
        details: {
          stripe_event: event.type,
          plan,
          status: statusFromStripe(sub.status),
          seats,
          cancel_at_period_end: cancelAtPeriodEnd,
        },
      });
      return { status: "processed", tenantId: updated.id, type: event.type };
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = idOf(sub.customer);
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const canceledAt = sub.canceled_at
        ? new Date(sub.canceled_at * 1000)
        : new Date();
      const result = await db
        .update(tenants)
        .set({
          status: "canceled",
          cancelAtPeriodEnd: false,
          canceledAt,
          updatedAt: new Date(),
        })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "canceled" },
        });
      }
      return { status: "processed", type: event.type };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = idOf(invoice.customer);
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const result = await db
        .update(tenants)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "active" },
        });
      }
      return { status: "processed", type: event.type };
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = idOf(invoice.customer);
      if (!customerId) return { status: "missing_tenant", type: event.type };
      const result = await db
        .update(tenants)
        .set({ status: "past_due", updatedAt: new Date() })
        .where(eq(tenants.stripeCustomerId, customerId))
        .returning({ id: tenants.id });
      const updated = result[0];
      if (updated) {
        await logAuditEvent({
          tenantId: updated.id,
          action: "subscription.changed",
          targetKind: "tenant",
          targetId: updated.id,
          details: { stripe_event: event.type, status: "past_due" },
        });
      }
      return { status: "processed", type: event.type };
    }

    default:
      return { status: "ignored", type: event.type };
  }
}
