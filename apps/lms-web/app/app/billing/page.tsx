import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { redirect } from "next/navigation";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isPlatformAdmin } from "~/lib/auth/platform";
import { accessLevelFor } from "~/lib/billing/access";
import { formatDate } from "~/lib/format/datetime";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { HelpPopover } from "~/components/ui/help-popover";
import { PageHeader } from "~/components/page-header";
import { pricingTiers, formatPrice } from "~/lib/site-config";

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

const REASON_COPY = {
  canceled: {
    title: "Your subscription was canceled",
    body: "Re-subscribe to restore access to your training data. Your members, modules, and history are still here.",
  },
  past_due: {
    title: "Payment failed",
    body: "We couldn't process your last payment. Update your payment method in the billing portal to restore full access.",
  },
  trialing_expired: {
    title: "Your free trial ended",
    body: "Pick a plan to keep using Tracey. Your trial data is preserved.",
  },
  active_pending_cancel: {
    title: "Cancellation scheduled",
    body: "Your subscription is set to cancel at the end of the current period. You can reactivate from the Stripe portal.",
  },
  active: {
    title: "Manage your subscription",
    body: "Change plan, update payment method, or cancel from the Stripe billing portal.",
  },
  trialing: {
    title: "You're on a free trial",
    body: "Pick a plan below when you're ready to continue, or end the trial early. Your data is preserved either way.",
  },
} as const;

export default async function BillingPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?returnTo=/app/billing");

  const membership = await currentMembership();
  if (!membership) redirect("/onboarding");
  const tenant = membership.tenant;

  const platformAdmin = isPlatformAdmin(user.email);
  const level = platformAdmin ? "full" : accessLevelFor(tenant);

  let reason: keyof typeof REASON_COPY = "active";
  if (tenant.status === "canceled") reason = "canceled";
  else if (tenant.status === "past_due") reason = "past_due";
  else if (
    tenant.status === "trialing" &&
    tenant.trialEndsAt &&
    tenant.trialEndsAt.getTime() <= Date.now()
  ) {
    reason = "trialing_expired";
  } else if (tenant.status === "trialing") {
    reason = "trialing";
  } else if (tenant.status === "active" && tenant.cancelAtPeriodEnd) {
    reason = "active_pending_cancel";
  }

  const copy = REASON_COPY[reason];
  const subscribable = pricingTiers.filter((t) => t.cta.kind === "signup");

  const trialDaysLeft =
    reason === "trialing" ? daysUntil(tenant.trialEndsAt) : null;
  const trialEndsAtLabel =
    reason === "trialing" && tenant.trialEndsAt
      ? formatDate(tenant.trialEndsAt, tenant.timezone, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <PageHeader title={copy.title} description={copy.body} />
      {trialDaysLeft !== null && (
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--foreground)]">
          {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} remaining
          {trialEndsAtLabel ? ` — until ${trialEndsAtLabel}` : ""}
          <HelpPopover label="About the trial">
            After the trial ends you&apos;ll be asked to choose a plan and add
            a card. We never auto-charge — you have to subscribe yourself.
          </HelpPopover>
        </p>
      )}
      {platformAdmin && level !== "full" && (
        <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Platform admin override: you have full access. Tenant&apos;s effective level is{" "}
          <strong>{accessLevelFor(tenant)}</strong>.
        </p>
      )}

      {tenant.stripeCustomerId && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-lg">
              Stripe billing portal
              <HelpPopover label="About the billing portal">
                Click <strong>Open billing portal</strong> to see and download
                your invoices, change your card, switch plan, or cancel. We
                use Stripe to host the portal — your card details never touch
                our servers.
              </HelpPopover>
            </CardTitle>
            <CardDescription>
              Update card, view invoices, change plan, or cancel.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <form action="/api/billing/portal" method="post" className="w-full">
              <Button type="submit" className="w-full">
                Open billing portal
              </Button>
            </form>
          </CardFooter>
        </Card>
      )}

      {!tenant.stripeCustomerId &&
        (reason === "canceled" ||
          reason === "trialing_expired" ||
          reason === "trialing") && (
        <div className="grid gap-4 md:grid-cols-2">
          {subscribable.map((tier) => {
            const monthly = tier.prices?.monthly.perSeatPerMonth ?? 0;
            const annual = tier.prices?.annual.perSeatPerMonth ?? 0;
            return (
              <Card key={tier.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-lg">
                    {tier.name}
                    <HelpPopover label="About this plan">
                      Annual billing saves 20% — you pay once, no monthly
                      invoices. Either plan can be cancelled any time from the
                      billing portal after subscribing.
                    </HelpPopover>
                  </CardTitle>
                  <CardDescription>{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div>
                    {formatPrice(monthly)}
                    <span className="text-[color:var(--muted-foreground)]"> /seat/month</span>
                  </div>
                  <div className="text-[color:var(--muted-foreground)]">
                    or {formatPrice(annual)}/seat/month billed annually (save 20%)
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                  <form action="/api/billing/checkout" method="post" className="w-full">
                    <input type="hidden" name="plan" value={tier.id} />
                    <input type="hidden" name="billing" value="monthly" />
                    <Button
                      type="submit"
                      variant={tier.featured ? "default" : "outline"}
                      className="w-full"
                    >
                      Subscribe monthly
                    </Button>
                  </form>
                  <form action="/api/billing/checkout" method="post" className="w-full">
                    <input type="hidden" name="plan" value={tier.id} />
                    <input type="hidden" name="billing" value="annual" />
                    <Button type="submit" variant="ghost" className="w-full">
                      Subscribe annually
                    </Button>
                  </form>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-8 text-sm">
        <BackLink href="/app">Back to dashboard</BackLink>
      </div>
    </div>
  );
}
