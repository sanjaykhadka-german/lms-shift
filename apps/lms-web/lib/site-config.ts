import type { Plan } from "@tracey/types";

export type Billing = "monthly" | "annual";

export const ANNUAL_DISCOUNT = 0.2; // 20% off when billed annually

/** Quiz pass threshold (percent). Shared with Flask via the same env var so
 *  a learner who passes here would also pass there. Default 80 matches
 *  Flask's PASS_THRESHOLD config default. */
export const PASS_THRESHOLD: number = (() => {
  const raw = process.env.LMS_PASS_THRESHOLD;
  if (!raw) return 80;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 80;
})();

// Single source of truth for trial length. Referenced by siteConfig below
// (so siteConfig.trialDays stays accurate) AND by the pricing tiers'
// feature list (which can't reference siteConfig itself without a cycle).
const TRIAL_DAYS = 14;

export const siteConfig = {
  name: "Tracey",
  tagline: "Staff training that doesn't get in the way of the work.",
  description:
    "Tracey is the multi-tenant staff-training platform for operations teams. " +
    "Quizzes, qualifications, and audit trails — without the LMS bloat.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000",
  trialDays: TRIAL_DAYS,
  contact: {
    sales: "sanjay.khadka@germanbutchery.com.au",
  },
} as const;

interface PriceSlot {
  /** Display amount in USD per seat per month. For annual, this is the
   *  effective monthly rate after the 20% discount. */
  perSeatPerMonth: number;
  priceEnvVar:
    | "STRIPE_PRICE_STARTER_MONTHLY"
    | "STRIPE_PRICE_STARTER_ANNUAL"
    | "STRIPE_PRICE_PRO_MONTHLY"
    | "STRIPE_PRICE_PRO_ANNUAL";
}

export interface PricingTier {
  id: Plan;
  name: string;
  description: string;
  features: string[];
  prices?: { monthly: PriceSlot; annual: PriceSlot };
  cta: { kind: "signup" | "contact"; href: string; label: string };
  featured?: boolean;
}

export const pricingTiers: readonly PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For small teams getting their training programme off the ground.",
    features: [
      "Up to 25 seats",
      "Unlimited modules and quizzes",
      "Email support",
      `${TRIAL_DAYS}-day free trial — no card required`,
    ],
    prices: {
      monthly: { perSeatPerMonth: 19, priceEnvVar: "STRIPE_PRICE_STARTER_MONTHLY" },
      annual: { perSeatPerMonth: 15.2, priceEnvVar: "STRIPE_PRICE_STARTER_ANNUAL" },
    },
    cta: { kind: "signup", href: "/sign-up?plan=starter", label: "Start free trial" },
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing operations that need AI-generated quizzes and branding.",
    features: [
      "Everything in Starter",
      "Unlimited seats",
      "AI quiz generation from your policies, procedures, and training documents",
      "Custom branding",
      "Priority support",
    ],
    prices: {
      monthly: { perSeatPerMonth: 39, priceEnvVar: "STRIPE_PRICE_PRO_MONTHLY" },
      annual: { perSeatPerMonth: 31.2, priceEnvVar: "STRIPE_PRICE_PRO_ANNUAL" },
    },
    cta: { kind: "signup", href: "/sign-up?plan=pro", label: "Start free trial" },
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large operations with SSO, SLAs, and dedicated success.",
    features: [
      "Everything in Pro",
      "SSO (SAML / OIDC)",
      "Custom SLAs",
      "Dedicated customer success manager",
      "Procurement-ready paperwork",
    ],
    cta: {
      kind: "contact",
      href: `mailto:sanjay.khadka@germanbutchery.com.au?subject=${encodeURIComponent(
        "Tracey Enterprise enquiry",
      )}`,
      label: "Contact sales",
    },
  },
] as const;

/** Look up the configured Stripe price ID for a given plan + billing cadence. */
export function priceIdFor(plan: Plan, billing: Billing): string | null {
  const tier = pricingTiers.find((t) => t.id === plan);
  const slot = tier?.prices?.[billing];
  if (!slot) return null;
  return process.env[slot.priceEnvVar] ?? null;
}

export function formatPrice(perSeatPerMonth: number): string {
  // Drop the trailing .0 for whole dollar amounts (e.g. $19, not $19.00),
  // but keep two decimals when the discounted annual rate has cents.
  const isWhole = Math.abs(perSeatPerMonth - Math.round(perSeatPerMonth)) < 0.01;
  return `$${isWhole ? perSeatPerMonth.toFixed(0) : perSeatPerMonth.toFixed(2)}`;
}
