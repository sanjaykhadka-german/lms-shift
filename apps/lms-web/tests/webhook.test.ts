import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@tracey/db", async () => await import("./fakes/db"));
vi.mock("drizzle-orm", async () => {
  const fake = await import("./fakes/db");
  return { eq: fake.eq, isNotNull: fake.isNotNull, sql: fake.sql };
});

import { handleStripeEvent } from "../lib/billing/handle-stripe-event";
import {
  resetFakeDb,
  seedTenant,
  getTenant,
  allTenants,
} from "./fakes/db";

function subscriptionEvent(
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  overrides: Partial<{
    id: string;
    customerId: string;
    subId: string;
    plan: string;
    status: Stripe.Subscription.Status;
    currentPeriodEnd: number | undefined;
    itemPeriodEnd: number | undefined;
    seats: number;
    cancelAtPeriodEnd: boolean;
    canceledAt: number | null;
    trialEnd: number | null;
  }> = {},
): Stripe.Event {
  const {
    id = `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    customerId = "cus_123",
    subId = "sub_123",
    plan = "pro",
    status = "active",
    seats = 5,
    cancelAtPeriodEnd = false,
    canceledAt = null,
    trialEnd = null,
  } = overrides;
  // Default keeps prior tests' behaviour: top-level field set, item field
  // absent. New tests can flip these to mimic the 2026-04-22.dahlia API
  // shape where current_period_end lives on each subscription item. Use the
  // `in` operator instead of destructuring defaults so callers can pass
  // `undefined` explicitly to mean "omit this field" — destructuring
  // defaults conflate undefined with not-passed.
  const currentPeriodEnd =
    "currentPeriodEnd" in overrides ? overrides.currentPeriodEnd : 1735689600;
  const itemPeriodEnd =
    "itemPeriodEnd" in overrides ? overrides.itemPeriodEnd : undefined;
  return {
    id,
    type,
    object: "event",
    api_version: "2024-12-18.acacia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: subId,
        object: "subscription",
        customer: customerId,
        status,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: canceledAt,
        trial_end: trialEnd,
        items: {
          object: "list",
          data: [
            {
              id: "si_1",
              price: { id: "price_1", metadata: { plan } },
              quantity: seats,
              current_period_end: itemPeriodEnd,
            },
          ],
        },
      } as unknown as Stripe.Subscription,
    },
  } as Stripe.Event;
}

describe("handleStripeEvent — customer.subscription.updated", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-1",
      clerkOrgId: "org_test",
      stripeCustomerId: "cus_123",
      plan: "free",
      status: "trialing",
    });
  });

  it("updates the tenant row to match the live subscription", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      plan: "pro",
      status: "active",
      currentPeriodEnd: 1735689600,
      seats: 7,
    });

    const result = await handleStripeEvent(event);

    expect(result.status).toBe("processed");
    const t = getTenant("tenant-1");
    expect(t).toBeDefined();
    expect(t!.plan).toBe("pro");
    expect(t!.status).toBe("active");
    expect(t!.currentPeriodEnd).toEqual(new Date(1735689600 * 1000));
    expect(t!.seatsPurchased).toBe(7);
    expect(t!.stripeSubscriptionId).toBe("sub_123");
  });

  it("maps unusual Stripe statuses to past_due", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      status: "incomplete",
    });
    await handleStripeEvent(event);
    expect(getTenant("tenant-1")!.status).toBe("past_due");
  });

  it("returns missing_tenant when no tenant matches the customer", async () => {
    const event = subscriptionEvent("customer.subscription.updated", {
      customerId: "cus_unknown",
    });
    const result = await handleStripeEvent(event);
    expect(result.status).toBe("missing_tenant");
  });

  it("persists cancel_at_period_end and canceled_at when set", async () => {
    const canceledAtSec = 1735000000;
    const event = subscriptionEvent("customer.subscription.updated", {
      cancelAtPeriodEnd: true,
      canceledAt: canceledAtSec,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-1") as { cancelAtPeriodEnd?: boolean; canceledAt?: Date };
    expect(t.cancelAtPeriodEnd).toBe(true);
    expect(t.canceledAt).toEqual(new Date(canceledAtSec * 1000));
  });

  it("reads current_period_end from the subscription item when API moved it off the top level", async () => {
    // Stripe API 2026-04-22.dahlia moved current_period_end onto each
    // SubscriptionItem. Simulate the runtime drift: top-level undefined,
    // item-level populated.
    const itemPeriodEndSec = 1738368000; // 2025-02-01
    const event = subscriptionEvent("customer.subscription.updated", {
      currentPeriodEnd: undefined,
      itemPeriodEnd: itemPeriodEndSec,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-1");
    expect(t!.currentPeriodEnd).toEqual(new Date(itemPeriodEndSec * 1000));
  });

  it("falls back to trial_end for currentPeriodEnd when neither subscription nor item has a period end", async () => {
    const trialEndSec = 1738972800; // 2025-02-08
    const event = subscriptionEvent("customer.subscription.created", {
      status: "trialing",
      currentPeriodEnd: undefined,
      itemPeriodEnd: undefined,
      trialEnd: trialEndSec,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-1");
    expect(t!.currentPeriodEnd).toEqual(new Date(trialEndSec * 1000));
  });

  it("extracts customer ID from an expanded Customer object (Stripe API 2026-04-22.preview)", async () => {
    // Stripe API 2026-04-22.preview ships sub.customer as the expanded
    // Customer object on webhook payloads in some scenarios. The handler
    // must read the id off the object, not silently null it out.
    const event = subscriptionEvent("customer.subscription.updated");
    // Mutate the constructed event to swap the bare-string customer for an
    // expanded object. Keep the id matching the seed tenant so the WHERE
    // clause still finds the row.
    (event.data.object as unknown as { customer: unknown }).customer = {
      id: "cus_123",
      object: "customer",
      email: "test@example.com",
    };
    const result = await handleStripeEvent(event);
    expect(result.status).toBe("processed");
    expect(getTenant("tenant-1")!.plan).toBe("pro");
  });

  it("syncs trialEndsAt from sub.trial_end so the local field tracks Stripe", async () => {
    const trialEndSec = 1736899200; // 2025-01-15
    const event = subscriptionEvent("customer.subscription.updated", {
      status: "trialing",
      trialEnd: trialEndSec,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-1") as { trialEndsAt?: Date };
    expect(t.trialEndsAt).toEqual(new Date(trialEndSec * 1000));
  });

  it("clears cancel_at_period_end when subscription resumes", async () => {
    seedTenant({
      id: "tenant-1",
      stripeCustomerId: "cus_123",
      status: "active",
      // simulate a prior pending-cancel state
      cancelAtPeriodEnd: true,
      canceledAt: new Date("2025-01-15"),
    } as unknown as Parameters<typeof seedTenant>[0]);
    const event = subscriptionEvent("customer.subscription.updated", {
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-1") as { cancelAtPeriodEnd?: boolean; canceledAt?: Date | null };
    expect(t.cancelAtPeriodEnd).toBe(false);
    expect(t.canceledAt).toBeNull();
  });
});

describe("handleStripeEvent — customer.subscription.deleted", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-del",
      stripeCustomerId: "cus_del",
      status: "active",
    });
  });

  it("flips status to canceled, clears cancelAtPeriodEnd, sets canceledAt", async () => {
    const canceledAtSec = 1736000000;
    const event = subscriptionEvent("customer.subscription.deleted", {
      customerId: "cus_del",
      canceledAt: canceledAtSec,
    });
    await handleStripeEvent(event);
    const t = getTenant("tenant-del") as {
      status?: string;
      cancelAtPeriodEnd?: boolean;
      canceledAt?: Date;
    };
    expect(t.status).toBe("canceled");
    expect(t.cancelAtPeriodEnd).toBe(false);
    expect(t.canceledAt).toEqual(new Date(canceledAtSec * 1000));
  });
});

describe("handleStripeEvent — checkout.session.completed", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-2",
      clerkOrgId: "org_test_2",
      plan: "free",
      status: "trialing",
    });
  });

  it("attaches Stripe customer/subscription IDs and flips status to active", async () => {
    const event = {
      id: "evt_checkout_1",
      type: "checkout.session.completed",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_1",
          object: "checkout.session",
          client_reference_id: "tenant-2",
          customer: "cus_456",
          subscription: "sub_456",
        },
      },
    } as unknown as Stripe.Event;

    const result = await handleStripeEvent(event);

    expect(result.status).toBe("processed");
    const t = getTenant("tenant-2");
    expect(t!.stripeCustomerId).toBe("cus_456");
    expect(t!.stripeSubscriptionId).toBe("sub_456");
    expect(t!.status).toBe("active");
  });

  it("extracts customer/subscription IDs from expanded objects (API 2026-04-22.preview)", async () => {
    // Stripe API 2026-04-22.preview ships session.customer + .subscription
    // as expanded objects rather than bare strings. The handler must pull
    // .id off the object instead of treating it as null.
    const event = {
      id: "evt_checkout_expanded_1",
      type: "checkout.session.completed",
      object: "event",
      api_version: "2026-04-22.preview",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: {
        object: {
          id: "cs_expanded",
          object: "checkout.session",
          client_reference_id: "tenant-2",
          customer: { id: "cus_exp_999", object: "customer" },
          subscription: { id: "sub_exp_999", object: "subscription" },
        },
      },
    } as unknown as Stripe.Event;

    const result = await handleStripeEvent(event);
    expect(result.status).toBe("processed");
    const t = getTenant("tenant-2");
    expect(t!.stripeCustomerId).toBe("cus_exp_999");
    expect(t!.stripeSubscriptionId).toBe("sub_exp_999");
    expect(t!.status).toBe("active");
  });
});

describe("handleStripeEvent — invoice.payment_failed", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-3",
      stripeCustomerId: "cus_789",
      status: "active",
    });
  });

  it("marks the tenant past_due", async () => {
    const event = {
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: { object: { object: "invoice", customer: "cus_789" } },
    } as unknown as Stripe.Event;

    await handleStripeEvent(event);
    expect(getTenant("tenant-3")!.status).toBe("past_due");
  });
});

describe("handleStripeEvent — unknown types", () => {
  beforeEach(() => resetFakeDb());

  it("records the event but ignores the body", async () => {
    const event = {
      id: "evt_unknown_1",
      type: "customer.created",
      object: "event",
      api_version: "2024-12-18.acacia",
      created: 0,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      data: { object: { object: "customer" } },
    } as unknown as Stripe.Event;

    const result = await handleStripeEvent(event);
    expect(result.status).toBe("ignored");
    expect(allTenants()).toHaveLength(0);
  });
});
