"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "~/components/ui/badge";

// ShiftCraft pricing — positioned above the LMS ($19/$39) because the
// workforce surface carries more operational scope: live punch + kiosk +
// timesheet + reports. Same 20%-off-annual structure so the toggle UX
// reads consistent across the Tracey suite.

type Billing = "monthly" | "annual";

interface Tier {
  id: string;
  name: string;
  tagline: string;
  prices?: { monthly: number; annual: number };
  features: string[];
  cta: { label: string; href: string };
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "For small teams stepping off paper rosters.",
    prices: { monthly: 29, annual: 23.2 },
    features: [
      "Up to 25 employees",
      "Live time clock + on-premise kiosk with selfie",
      "Weekly roster, shift swaps, time-off requests",
      "Timesheets with CSV export",
      "14-day free trial — no card required",
    ],
    cta: { label: "Start free trial", href: "/sign-up?plan=starter" },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing operations that need cost + audit visibility.",
    prices: { monthly: 59, annual: 47.2 },
    features: [
      "Everything in Starter",
      "Unlimited employees and locations",
      "Cost reporting, scheduled vs actual, anomaly flags",
      "Bulk approvals + audit log",
      "Department + role-based filters",
      "Priority support",
    ],
    cta: { label: "Start free trial", href: "/sign-up?plan=pro" },
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For multi-site operators with SSO + procurement needs.",
    features: [
      "Everything in Pro",
      "SSO (SAML / OIDC)",
      "Custom SLAs + dedicated CSM",
      "Per-tenant data residency on request",
      "Procurement-ready paperwork + DPAs",
    ],
    cta: {
      label: "Contact sales",
      href: `mailto:sanjay.khadka@germanbutchery.com.au?subject=${encodeURIComponent(
        "ShiftCraft Enterprise enquiry",
      )}`,
    },
  },
];

function fmtPrice(value: number): string {
  // Whole-dollar amounts as "$29"; discounted annuals as "$23.20".
  const isWhole = Math.abs(value - Math.round(value)) < 0.01;
  return `$${isWhole ? value.toFixed(0) : value.toFixed(2)}`;
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section id="pricing" className="border-y border-line bg-[var(--paper-2)]/40">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            Pricing
          </div>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em] text-ink md:text-4xl">
            Priced per employee.{" "}
            <span className="relative inline-block">
              <span className="relative z-10">14-day free trial.</span>
              <span
                aria-hidden
                className="absolute inset-x-[-4px] bottom-1 z-0 h-3 -rotate-1 rounded-[3px] bg-[var(--accent)]"
              />
            </span>
          </h2>
          <p className="mt-3 text-ink-2">
            Pay only when your team's on board. Switch to annual to save 20%.
          </p>
          <div className="mt-6 inline-flex items-center rounded-full border border-line bg-[var(--paper)] p-1 text-sm">
            <button
              type="button"
              onClick={() => setBilling("monthly")}
              className={
                billing === "monthly"
                  ? "rounded-full bg-[var(--ink)] px-4 py-1.5 font-semibold text-[var(--paper)]"
                  : "rounded-full px-4 py-1.5 text-ink-2 hover:text-ink"
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
                  : "rounded-full px-4 py-1.5 text-ink-2 hover:text-ink"
              }
            >
              Annual
              <Badge variant="live" size="sm" className="ml-2">
                Save 20%
              </Badge>
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {TIERS.map((tier) => {
            const price = tier.prices?.[billing];
            const annualTotal = tier.prices
              ? Math.round(tier.prices.annual * 12)
              : null;
            return (
              <div
                key={tier.id}
                className={
                  tier.featured
                    ? "relative flex flex-col rounded-xl border-2 border-primary bg-card p-6 shadow-md"
                    : "flex flex-col rounded-xl border border-border bg-card p-6 shadow-sm"
                }
              >
                {tier.featured ? (
                  <span className="absolute -top-3 right-6 inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                    Most popular
                  </span>
                ) : null}
                <div className="flex items-baseline justify-between gap-2">
                  <h3
                    className="text-xl"
                    style={{
                      fontFamily:
                        "var(--font-heading), ui-serif, Georgia, serif",
                    }}
                  >
                    {tier.name}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier.tagline}
                </p>

                <div className="mt-4">
                  {price != null ? (
                    <>
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-semibold tabular-nums">
                          {fmtPrice(price)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          / employee / month
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {billing === "annual" && annualTotal != null
                          ? `Billed annually — $${annualTotal} per employee per year`
                          : "Billed monthly. Switch to annual to save 20%."}
                      </p>
                    </>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold">
                        Contact sales
                      </span>
                    </div>
                  )}
                </div>

                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={
                    tier.prices ? `${tier.cta.href}&billing=${billing}` : tier.cta.href
                  }
                  className={
                    tier.featured
                      ? "mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
                      : "mt-6 inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
                  }
                >
                  {tier.cta.label}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-muted-foreground">
          Prices in AUD, excluding GST. Tracey covers your LMS and ShiftCraft
          workspaces under one account — your team only needs one login.
        </p>
      </div>
    </section>
  );
}
