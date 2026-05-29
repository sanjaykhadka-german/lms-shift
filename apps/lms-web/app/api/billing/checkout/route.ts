import { NextResponse, type NextRequest } from "next/server";
import type { Tenant } from "@tracey/db";
import { currentUser, currentTenant } from "~/lib/auth/current";
import { stripe } from "~/lib/stripe";
import { siteConfig, priceIdFor, type Billing } from "~/lib/site-config";
import type { Plan } from "@tracey/types";

const DAY_MS = 24 * 60 * 60 * 1000;
// Stripe's hard cap on trial_period_days. We'll never approach this with a
// 14-day product trial, but clamp anyway so a corrupt trialEndsAt can't
// produce an API error from Stripe.
const STRIPE_MAX_TRIAL_DAYS = 730;

// Days left of the tenant's existing trial, to pass to Stripe so we don't
// gift a second trial on top. Returns 0 for non-trialing tenants (they get
// charged immediately) or tenants whose trial has already expired.
function remainingTrialDays(tenant: Tenant): number {
  if (tenant.status !== "trialing") return 0;
  if (!tenant.trialEndsAt) return 0;
  const ms = tenant.trialEndsAt.getTime() - Date.now();
  const days = Math.ceil(ms / DAY_MS);
  return Math.max(0, Math.min(STRIPE_MAX_TRIAL_DAYS, days));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "no active workspace" }, { status: 400 });
  }

  const form = await req.formData();
  const planRaw = form.get("plan");
  if (planRaw !== "starter" && planRaw !== "pro") {
    return NextResponse.json(
      { error: "plan must be 'starter' or 'pro'" },
      { status: 400 },
    );
  }
  const billingRaw = form.get("billing");
  const billing: Billing = billingRaw === "annual" ? "annual" : "monthly";
  const plan = planRaw as Plan;
  const priceId = priceIdFor(plan, billing);
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price configured for ${plan}/${billing}` },
      { status: 500 },
    );
  }

  const customerEmail = user.email;
  const trialDays = remainingTrialDays(tenant);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: tenant.id,
    customer: tenant.stripeCustomerId ?? undefined,
    customer_email: tenant.stripeCustomerId ? undefined : customerEmail,
    subscription_data: {
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      metadata: { tenant_id: tenant.id, plan, billing },
    },
    allow_promotion_codes: true,
    success_url: `${siteConfig.url}/app?checkout=success`,
    cancel_url: `${siteConfig.url}/app?checkout=cancelled`,
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a session URL" }, { status: 502 });
  }
  return NextResponse.redirect(session.url, { status: 303 });
}
