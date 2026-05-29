import { describe, it, expect, beforeEach, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@tracey/db", async () => await import("./fakes/db"));
vi.mock("drizzle-orm", async () => {
  const fake = await import("./fakes/db");
  return { eq: fake.eq, isNotNull: fake.isNotNull, sql: fake.sql };
});

import { handleStripeEvent } from "../lib/billing/handle-stripe-event";
import { resetFakeDb, seedTenant, getTenant } from "./fakes/db";

const event = {
  id: "evt_idem_1",
  type: "customer.subscription.updated",
  object: "event",
  api_version: "2024-12-18.acacia",
  created: 0,
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  data: {
    object: {
      id: "sub_x",
      object: "subscription",
      customer: "cus_x",
      status: "active",
      current_period_end: 1735689600,
      items: {
        object: "list",
        data: [
          {
            id: "si_1",
            price: { id: "p_1", metadata: { plan: "pro" } },
            quantity: 3,
          },
        ],
      },
    },
  },
} as unknown as Stripe.Event;

describe("handleStripeEvent — idempotency", () => {
  beforeEach(() => {
    resetFakeDb();
    seedTenant({
      id: "tenant-x",
      stripeCustomerId: "cus_x",
      plan: "free",
      status: "trialing",
      seatsPurchased: 0,
    });
  });

  it("processes the event the first time", async () => {
    const result = await handleStripeEvent(event);
    expect(result.status).toBe("processed");
    const t = getTenant("tenant-x")!;
    expect(t.plan).toBe("pro");
    expect(t.seatsPurchased).toBe(3);
  });

  it("returns duplicate without mutating on the second delivery", async () => {
    await handleStripeEvent(event);

    // Tamper with the row in between to prove no second mutation occurs:
    const before = getTenant("tenant-x")!;
    before.seatsPurchased = 999;

    const second = await handleStripeEvent(event);

    expect(second.status).toBe("duplicate");
    expect(getTenant("tenant-x")!.seatsPurchased).toBe(999);
  });
});
