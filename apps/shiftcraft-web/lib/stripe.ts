import "server-only";
import Stripe from "stripe";

// ShiftCraft shares the Tracey Stripe account with lms-web but bills on its
// OWN subscriptions (one tenant_subscriptions row per app). The customer is
// shared per tenant; the subscription + price ids are app-specific.
//
// IMPORTANT: construction is LAZY. Next.js imports route modules (including
// /api/billing/checkout and /api/webhooks/stripe) during `next build`'s
// "collect page data" phase. If we threw on a missing STRIPE_SECRET_KEY at
// module load, the whole build would fail (exit 1) on any deploy where the
// Stripe env vars aren't set yet — which is the normal state until billing is
// switched on. So the key is only required when the client is actually used
// at request time, never at import/build.
let cached: Stripe | null = null;

function getStripe(): Stripe {
  if (cached) return cached;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  cached = new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "tracey-shiftcraft-web", version: "0.0.0" },
  });
  return cached;
}

// A lazy proxy so callers keep using `stripe.checkout.sessions.create(...)`
// etc. unchanged. The real client is built (and the key validated) on first
// property access — i.e. at request time, not at import/build time.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
