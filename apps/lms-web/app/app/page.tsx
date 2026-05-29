import Link from "next/link";
import { currentTenant } from "~/lib/auth/current";
import { formatDate } from "~/lib/format/datetime";
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
import { pricingTiers } from "~/lib/site-config";

const statusVariant = {
  trialing: "warning",
  active: "success",
  past_due: "destructive",
  canceled: "secondary",
} as const;

const statusLabel = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
} as const;

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default async function DashboardPage() {
  const tenant = await currentTenant();
  if (!tenant) return null; // layout already redirected

  const trialDaysLeft =
    tenant.status === "trialing" ? daysUntil(tenant.trialEndsAt) : null;
  const planName =
    pricingTiers.find((t) => t.id === tenant.plan)?.name ??
    tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1);

  const showPendingCancel =
    tenant.status === "active" && tenant.cancelAtPeriodEnd;
  const cancelOn = tenant.currentPeriodEnd
    ? formatDate(tenant.currentPeriodEnd, tenant.timezone, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "the end of the current period";

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-10">
      <div className="relative overflow-hidden rounded-xl border border-[color:var(--border)] bg-gradient-to-br from-[color:var(--primary)]/8 via-[color:var(--card)] to-[color:var(--accent)]/8 p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[color:var(--primary)]/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <Badge variant={statusVariant[tenant.status as keyof typeof statusVariant]}>
              {statusLabel[tenant.status as keyof typeof statusLabel]}
              {trialDaysLeft !== null && ` — ${trialDaysLeft}d left`}
            </Badge>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Welcome back, {tenant.name}
            </h1>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              Pick up where you left off, or check your team&apos;s progress.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/app/my/modules">Go to my training</Link>
          </Button>
        </div>
      </div>

      {showPendingCancel && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            Subscription scheduled to cancel on <strong>{cancelOn}</strong>. Reactivate from the billing portal to keep access.
          </span>
          <form action="/api/billing/portal" method="post">
            <Button type="submit" variant="outline" size="sm">
              Reactivate
            </Button>
          </form>
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan</CardTitle>
            <CardDescription>
              You are on the <strong>{planName}</strong> plan.
              {tenant.currentPeriodEnd && (
                <> Renews {tenant.currentPeriodEnd.toISOString().slice(0, 10)}.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenant.stripeCustomerId ? (
              <BillingPortalButton />
            ) : (
              <SubscribeButtons />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Training</CardTitle>
            <CardDescription>
              See your assigned modules, take quizzes, and review past results.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href="/app/my/modules">My training</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function BillingPortalButton() {
  return (
    <form action="/api/billing/portal" method="post">
      <Button type="submit" className="w-full">
        Manage billing
      </Button>
    </form>
  );
}

function SubscribeButtons() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[color:var(--muted-foreground)]">
        Pick a paid plan to continue after your trial.
      </p>
      <div className="flex flex-wrap gap-2">
        {pricingTiers
          .filter((t) => t.cta.kind === "signup")
          .map((tier) => (
            <form key={tier.id} action="/api/billing/checkout" method="post">
              <input type="hidden" name="plan" value={tier.id} />
              <input type="hidden" name="billing" value="monthly" />
              <Button
                type="submit"
                variant={tier.featured ? "default" : "outline"}
                size="sm"
              >
                Subscribe — {tier.name}
              </Button>
            </form>
          ))}
        <Button asChild variant="ghost" size="sm">
          <Link href="/#pricing">Compare plans</Link>
        </Button>
      </div>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Annual billing (save 20%) available from Manage billing after upgrade.
      </p>
    </div>
  );
}
