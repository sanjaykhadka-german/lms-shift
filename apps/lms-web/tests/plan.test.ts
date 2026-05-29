import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { planFromPrice, statusFromStripe } from "../lib/billing/plan";

describe("planFromPrice", () => {
  it("returns the plan from price.metadata.plan when valid", () => {
    expect(planFromPrice({ metadata: { plan: "starter" } } as unknown as Stripe.Price)).toBe(
      "starter",
    );
    expect(planFromPrice({ metadata: { plan: "PRO" } } as unknown as Stripe.Price)).toBe(
      "pro",
    );
  });

  it("falls back to 'free' for missing or unrecognised metadata", () => {
    expect(planFromPrice(null)).toBe("free");
    expect(planFromPrice(undefined)).toBe("free");
    expect(planFromPrice({ metadata: {} } as unknown as Stripe.Price)).toBe("free");
    expect(
      planFromPrice({ metadata: { plan: "platinum" } } as unknown as Stripe.Price),
    ).toBe("free");
  });
});

describe("statusFromStripe", () => {
  it("maps the Stripe statuses we model verbatim", () => {
    expect(statusFromStripe("trialing")).toBe("trialing");
    expect(statusFromStripe("active")).toBe("active");
    expect(statusFromStripe("canceled")).toBe("canceled");
    expect(statusFromStripe("incomplete_expired")).toBe("canceled");
  });

  it("treats every other status (incomplete, past_due, paused, unpaid) as past_due", () => {
    expect(statusFromStripe("incomplete")).toBe("past_due");
    expect(statusFromStripe("past_due")).toBe("past_due");
    expect(statusFromStripe("paused")).toBe("past_due");
    expect(statusFromStripe("unpaid")).toBe("past_due");
  });
});
