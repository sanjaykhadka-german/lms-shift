import { redirect } from "next/navigation";
import { getSubscription } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { SubscribePlans } from "../_subscribe-plans";

export const metadata = { title: "Billing · ShiftCraft" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment overdue",
  canceled: "Canceled",
};

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function BillingPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const sub = await getSubscription(membership.tenant.id, "shiftcraft");
  const status = sub?.status ?? "trialing";
  const trialEnds = fmtDate(sub?.trialEndsAt ?? null);
  const periodEnd = fmtDate(sub?.currentPeriodEnd ?? null);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <div>
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Billing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your ShiftCraft subscription. LMS is billed separately.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Current plan</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Status
            </dt>
            <dd className="mt-0.5 font-medium">
              {STATUS_LABEL[status] ?? status}
              {sub?.cancelAtPeriodEnd ? " (ends at period end)" : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">
              Plan
            </dt>
            <dd className="mt-0.5 font-medium capitalize">
              {sub?.plan ?? "—"}
            </dd>
          </div>
          {status === "trialing" && trialEnds ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Trial ends
              </dt>
              <dd className="mt-0.5 font-medium">{trialEnds}</dd>
            </div>
          ) : null}
          {periodEnd ? (
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                Renews
              </dt>
              <dd className="mt-0.5 font-medium">{periodEnd}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">
          {status === "active" ? "Change plan" : "Subscribe"}
        </h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          {status === "active"
            ? "Switch tier or billing cadence — Stripe prorates the difference."
            : "Pick a plan to start your paid subscription. Billed per employee."}
        </p>
        <SubscribePlans
          defaultPlan={sub?.plan === "pro" ? "pro" : "starter"}
        />
      </section>
    </div>
  );
}
