"use client";

import { useState } from "react";

// Subscribe call-to-action used by both the billing wall (gated tenants) and
// the /app/billing management page. Each card is a plain <form> POSTing to the
// checkout route — no client fetch, so the browser follows Stripe's 303 to the
// hosted checkout. Prices mirror the marketing page (_pricing.tsx).

type Billing = "monthly" | "annual";

interface Tier {
  id: "starter" | "pro";
  name: string;
  prices: { monthly: number; annual: number };
  blurb: string;
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    prices: { monthly: 29, annual: 23.2 },
    blurb: "Time clock, kiosk, rosters, timesheets.",
  },
  {
    id: "pro",
    name: "Pro",
    prices: { monthly: 59, annual: 47.2 },
    blurb: "Everything in Starter + cost reporting, audit, bulk ops.",
    featured: true,
  },
];

function fmt(v: number): string {
  const whole = Math.abs(v - Math.round(v)) < 0.01;
  return `$${whole ? v.toFixed(0) : v.toFixed(2)}`;
}

export function SubscribePlans({ defaultPlan }: { defaultPlan?: "starter" | "pro" }) {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center rounded-full border border-border bg-background p-1 text-sm">
        <button
          type="button"
          onClick={() => setBilling("monthly")}
          className={
            billing === "monthly"
              ? "rounded-full bg-[var(--ink)] px-4 py-1.5 font-semibold text-[var(--paper)]"
              : "rounded-full px-4 py-1.5 text-muted-foreground hover:text-foreground"
          }
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setBilling("annual")}
          className={
            billing === "annual"
              ? "rounded-full bg-[var(--ink)] px-4 py-1.5 font-semibold text-[var(--paper)]"
              : "rounded-full px-4 py-1.5 text-muted-foreground hover:text-foreground"
          }
        >
          Annual <span className="ml-1 text-xs">(save 20%)</span>
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => (
          <form
            key={tier.id}
            method="post"
            action="/api/billing/checkout"
            className={
              tier.featured || defaultPlan === tier.id
                ? "flex flex-col rounded-xl border-2 border-primary bg-card p-5 shadow-sm"
                : "flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm"
            }
          >
            <input type="hidden" name="plan" value={tier.id} />
            <input type="hidden" name="billing" value={billing} />
            <h3 className="text-base font-semibold">{tier.name}</h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tabular-nums">
                {fmt(tier.prices[billing])}
              </span>
              <span className="text-xs text-muted-foreground">
                / employee / month
              </span>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted-foreground">
              {tier.blurb}
            </p>
            <button
              type="submit"
              className={
                tier.featured || defaultPlan === tier.id
                  ? "mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                  : "mt-4 inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
              }
            >
              Subscribe to {tier.name}
            </button>
          </form>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Billed per employee in AUD (excl. GST). You can change or cancel any
        time from Stripe&rsquo;s billing portal. Enterprise?{" "}
        <a
          className="underline"
          href="mailto:sanjay.khadka@germanbutchery.com.au?subject=ShiftCraft%20Enterprise"
        >
          Contact sales
        </a>
        .
      </p>
    </div>
  );
}
