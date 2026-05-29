import type { Tenant } from "@tracey/db";

export type AccessLevel = "full" | "read_only" | "blocked";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Decide what a tenant can do based on subscription status.
 *
 * - canceled                              → blocked (redirect to /app/billing)
 * - past_due, within 7d of period-end     → read_only (Stripe dunning grace)
 * - past_due, beyond 7d                   → blocked
 * - trialing, trial_ends_at in the future → full
 * - trialing, trial_ends_at in the past   → read_only (softer than canceled —
 *                                            never-paid users keep view access
 *                                            so they can export before deciding)
 * - active                                → full (cancel_at_period_end is a
 *                                            future-dated state; access stays
 *                                            until the period actually ends)
 */
export function accessLevelFor(
  tenant: Pick<
    Tenant,
    "status" | "trialEndsAt" | "currentPeriodEnd"
  >,
  now: Date = new Date(),
): AccessLevel {
  switch (tenant.status) {
    case "active":
      return "full";

    case "trialing":
      if (tenant.trialEndsAt && tenant.trialEndsAt.getTime() > now.getTime()) {
        return "full";
      }
      return "read_only";

    case "past_due": {
      const periodEnd = tenant.currentPeriodEnd?.getTime() ?? null;
      if (periodEnd === null) {
        // No period end recorded yet — give the benefit of the doubt for the
        // grace window (7d from now).
        return "read_only";
      }
      if (periodEnd + SEVEN_DAYS_MS > now.getTime()) {
        return "read_only";
      }
      return "blocked";
    }

    case "canceled":
      return "blocked";

    default:
      // Unknown status — fail closed.
      return "blocked";
  }
}
