"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";
import {
  pricingTiers,
  formatPrice,
  siteConfig,
  type Billing,
} from "~/lib/site-config";

export function Pricing() {
  const [billing, setBilling] = useState<Billing>("monthly");

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Simple pricing, generous trial
        </h2>
        <p className="mt-3 text-[color:var(--muted-foreground)]">
          Start free for {siteConfig.trialDays} days. Upgrade only when your team is on board.
        </p>
        <BillingToggle billing={billing} onChange={setBilling} />
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {pricingTiers.map((tier) => (
          <Card
            key={tier.id}
            className={cn(
              "flex flex-col",
              tier.featured && "ring-2 ring-[color:var(--primary)]",
            )}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">{tier.name}</CardTitle>
                {tier.featured && <Badge>Most popular</Badge>}
              </div>
              <CardDescription className="pt-1">{tier.description}</CardDescription>
              <PriceLabel tier={tier} billing={billing} />
            </CardHeader>
            <CardContent className="flex-1">
              <ul className="space-y-2 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                asChild
                className="w-full"
                variant={tier.featured ? "default" : "outline"}
              >
                <Link
                  href={
                    tier.cta.kind === "signup"
                      ? `${tier.cta.href}&billing=${billing}`
                      : tier.cta.href
                  }
                >
                  {tier.cta.label}
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  );
}

function BillingToggle({
  billing,
  onChange,
}: {
  billing: Billing;
  onChange: (b: Billing) => void;
}) {
  return (
    <div className="mt-6 inline-flex items-center rounded-full border border-[color:var(--border)] p-1 text-sm">
      <ToggleButton active={billing === "monthly"} onClick={() => onChange("monthly")}>
        Monthly
      </ToggleButton>
      <ToggleButton active={billing === "annual"} onClick={() => onChange("annual")}>
        Annual
        <Badge variant="secondary" className="ml-2">
          Save 20%
        </Badge>
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full px-4 py-1.5 transition-colors",
        active
          ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
          : "text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

function PriceLabel({
  tier,
  billing,
}: {
  tier: (typeof pricingTiers)[number];
  billing: Billing;
}) {
  if (!tier.prices) {
    return (
      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-semibold">Contact sales</span>
      </div>
    );
  }
  const slot = tier.prices[billing];
  const annualTotal = Math.round(tier.prices.annual.perSeatPerMonth * 12);
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-semibold">{formatPrice(slot.perSeatPerMonth)}</span>
        <span className="text-sm text-[color:var(--muted-foreground)]">
          /month
        </span>
      </div>
      {billing === "annual" ? (
        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          Billed annually — ${annualTotal}/year
        </p>
      ) : (
        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
          Billed monthly. Switch to annual to save 20%.
        </p>
      )}
    </div>
  );
}
