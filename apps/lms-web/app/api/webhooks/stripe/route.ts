import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "~/lib/stripe";
import { handleStripeEvent } from "~/lib/billing/handle-stripe-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing stripe-signature" }, { status: 400 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    console.error("[webhooks/stripe] handler failed", err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
