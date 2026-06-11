import "server-only";
import Stripe from "stripe";

// ShiftCraft shares the Tracey Stripe account with lms-web but bills on its
// OWN subscriptions (one tenant_subscriptions row per app). The customer is
// shared per tenant; the subscription + price ids are app-specific.
const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY is required");
}

const globalForStripe = globalThis as unknown as { __traceyStripeSc?: Stripe };

export const stripe =
  globalForStripe.__traceyStripeSc ??
  new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "tracey-shiftcraft-web", version: "0.0.0" },
  });

if (process.env.NODE_ENV !== "production") {
  globalForStripe.__traceyStripeSc = stripe;
}
