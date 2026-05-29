import { NextResponse } from "next/server";
import { currentUser, currentTenant } from "~/lib/auth/current";
import { stripe } from "~/lib/stripe";
import { siteConfig } from "~/lib/site-config";

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "no active workspace" }, { status: 400 });
  }
  if (!tenant.stripeCustomerId) {
    return NextResponse.json(
      { error: "no Stripe customer — subscribe first" },
      { status: 400 },
    );
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${siteConfig.url}/app`,
  });
  return NextResponse.redirect(portal.url, { status: 303 });
}
