import { describe, it, expect } from "vitest";
import { accessLevelFor } from "../lib/billing/access";
import type { Tenant } from "@tracey/db";

type TenantInput = Pick<Tenant, "status" | "trialEndsAt" | "currentPeriodEnd">;

const NOW = new Date("2026-05-08T00:00:00Z");
const FUTURE = new Date("2026-06-08T00:00:00Z"); // +31 days
const PAST = new Date("2026-05-01T00:00:00Z"); // -7 days
const SIX_DAYS_AGO = new Date("2026-05-02T00:00:00Z"); // within 7d grace
const EIGHT_DAYS_AGO = new Date("2026-04-30T00:00:00Z"); // past 7d grace

function tenant(t: Partial<TenantInput>): TenantInput {
  return {
    status: "active",
    trialEndsAt: FUTURE,
    currentPeriodEnd: FUTURE,
    ...t,
  } as TenantInput;
}

describe("accessLevelFor", () => {
  it("active tenant → full", () => {
    expect(accessLevelFor(tenant({ status: "active" }), NOW)).toBe("full");
  });

  it("trialing with future trial_ends_at → full", () => {
    expect(
      accessLevelFor(tenant({ status: "trialing", trialEndsAt: FUTURE }), NOW),
    ).toBe("full");
  });

  it("trialing with past trial_ends_at → read_only (softer than canceled)", () => {
    expect(
      accessLevelFor(tenant({ status: "trialing", trialEndsAt: PAST }), NOW),
    ).toBe("read_only");
  });

  it("past_due within 7d of period end → read_only", () => {
    expect(
      accessLevelFor(
        tenant({ status: "past_due", currentPeriodEnd: SIX_DAYS_AGO }),
        NOW,
      ),
    ).toBe("read_only");
  });

  it("past_due beyond 7d of period end → blocked", () => {
    expect(
      accessLevelFor(
        tenant({ status: "past_due", currentPeriodEnd: EIGHT_DAYS_AGO }),
        NOW,
      ),
    ).toBe("blocked");
  });

  it("past_due with no period_end → read_only (benefit of the doubt)", () => {
    expect(
      accessLevelFor(
        tenant({ status: "past_due", currentPeriodEnd: null }),
        NOW,
      ),
    ).toBe("read_only");
  });

  it("canceled → blocked (hard block)", () => {
    expect(accessLevelFor(tenant({ status: "canceled" }), NOW)).toBe(
      "blocked",
    );
  });

  it("unknown status → blocked (fail closed)", () => {
    expect(
      accessLevelFor(tenant({ status: "garbage" as Tenant["status"] }), NOW),
    ).toBe("blocked");
  });
});
