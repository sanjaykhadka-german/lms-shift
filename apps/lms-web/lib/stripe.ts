import "server-only";
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  throw new Error("STRIPE_SECRET_KEY is required");
}

const globalForStripe = globalThis as unknown as { __traceyStripe?: Stripe };

export const stripe =
  globalForStripe.__traceyStripe ??
  new Stripe(secretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "tracey-lms-web", version: "0.0.0" },
  });

if (process.env.NODE_ENV !== "production") {
  globalForStripe.__traceyStripe = stripe;
}
