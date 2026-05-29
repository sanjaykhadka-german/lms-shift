import type Stripe from "stripe";
import type { Plan, SubscriptionStatus } from "@tracey/types";

const PLAN_VALUES = new Set<Plan>(["free", "starter", "pro", "enterprise"]);
const STATUS_VALUES = new Set<SubscriptionStatus>([
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

export function planFromPrice(price: Stripe.Price | null | undefined): Plan {
  const candidate = price?.metadata?.plan?.toLowerCase();
  if (candidate && PLAN_VALUES.has(candidate as Plan)) return candidate as Plan;
  return "free";
}

/**
 * Stripe's subscription.status has more values than ours; map the relevant
 * ones and fall back to past_due for anything paused / incomplete.
 */
export function statusFromStripe(s: Stripe.Subscription.Status): SubscriptionStatus {
  if (s === "trialing") return "trialing";
  if (s === "active") return "active";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "past_due";
}

export function isKnownStatus(s: string): s is SubscriptionStatus {
  return STATUS_VALUES.has(s as SubscriptionStatus);
}
