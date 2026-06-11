import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { forTenant, getSubscription, scEmployees } from "@tracey/db";
import type { Plan } from "@tracey/types";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { stripe } from "~/lib/stripe";
import { priceIdFor, siteUrl, type Billing } from "~/lib/billing/pricing";

const DAY_MS = 24 * 60 * 60 * 1000;
const STRIPE_MAX_TRIAL_DAYS = 730;

// Days left of the tenant's ShiftCraft trial, passed to Stripe so we don't
// gift a second trial on top of the in-app one. 0 once the trial has lapsed.
function remainingTrialDays(
  status: string,
  trialEndsAt: Date | null,
): number {
  if (status !== "trialing" || !trialEndsAt) return 0;
  const days = Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS);
  return Math.max(0, Math.min(STRIPE_MAX_TRIAL_DAYS, days));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const membership = await currentMembership();
  if (!membership) {
    return NextResponse.json({ error: "no active workspace" }, { status: 400 });
  }
  const tenantId = membership.tenant.id;

  const form = await req.formData();
  const planRaw = form.get("plan");
  if (planRaw !== "starter" && planRaw !== "pro") {
    return NextResponse.json(
      { error: "plan must be 'starter' or 'pro'" },
      { status: 400 },
    );
  }
  const plan = planRaw as Plan;
  const billing: Billing = form.get("billing") === "annual" ? "annual" : "monthly";
  const priceId = priceIdFor(plan, billing);
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price configured for shiftcraft ${plan}/${billing}` },
      { status: 500 },
    );
  }

  const sub = await getSubscription(tenantId, "shiftcraft");

  // Per-seat: bill for the current headcount (≥1). Ongoing seat-sync as staff
  // are added/removed is a follow-up; this sets the quantity at purchase time.
  const countRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(scEmployees)
      .where(sql`${scEmployees.traceyTenantId} = ${tenantId}`),
  );
  const seats = Math.max(1, countRows[0]?.count ?? 0);
  const trialDays = remainingTrialDays(sub?.status ?? "trialing", sub?.trialEndsAt ?? null);

  const metadata = { tenant_id: tenantId, app: "shiftcraft", plan, billing };
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: seats }],
    client_reference_id: tenantId,
    customer: sub?.stripeCustomerId ?? undefined,
    customer_email: sub?.stripeCustomerId ? undefined : user.email,
    metadata,
    subscription_data: {
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      metadata,
    },
    allow_promotion_codes: true,
    success_url: `${siteUrl()}/app?checkout=success`,
    cancel_url: `${siteUrl()}/app/billing?checkout=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "Stripe did not return a session URL" },
      { status: 502 },
    );
  }
  return NextResponse.redirect(session.url, { status: 303 });
}
