import type { Plan } from "@tracey/types";

export type Billing = "monthly" | "annual";

// ShiftCraft Stripe price ids resolved from env, mirroring lms-web's
// STRIPE_PRICE_* pattern but with shiftcraft-specific names so the two apps
// never share a price. Only the paid tiers map; enterprise is contact-sales.
const PRICE_ENV: Record<
  Exclude<Plan, "free" | "enterprise">,
  Record<Billing, string>
> = {
  starter: {
    monthly: "STRIPE_PRICE_SHIFTCRAFT_STARTER_MONTHLY",
    annual: "STRIPE_PRICE_SHIFTCRAFT_STARTER_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_SHIFTCRAFT_PRO_MONTHLY",
    annual: "STRIPE_PRICE_SHIFTCRAFT_PRO_ANNUAL",
  },
};

/** Configured Stripe price id for a ShiftCraft plan + billing cadence, or null. */
export function priceIdFor(plan: Plan, billing: Billing): string | null {
  if (plan === "free" || plan === "enterprise") return null;
  const envVar = PRICE_ENV[plan]?.[billing];
  if (!envVar) return null;
  return process.env[envVar] ?? null;
}

/** Public origin for Stripe success/cancel redirects (build-time inlined). */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SHIFTCRAFT_URL ?? "http://localhost:4100";
}
