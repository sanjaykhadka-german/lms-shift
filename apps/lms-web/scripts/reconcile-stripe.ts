/**
 * Nightly Stripe → DB reconciler.
 *
 * For every tenant with a stripe_subscription_id, fetch the live subscription
 * from Stripe and reconcile our row's status / current_period_end / plan in
 * case a webhook was missed. Idempotent. Wired to a Render cron job in
 * render.yaml at "0 3 * * *".
 *
 * Run locally with:  pnpm --filter lms-web run reconcile:stripe
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { eq, isNotNull } from "drizzle-orm";
import { db, tenants } from "@tracey/db";
import { planFromPrice, statusFromStripe } from "../lib/billing/plan";

// Load the workspace-root .env when run locally (cwd = apps/lms-web/).
// Production (Render cron) gets env vars from the platform — readFile failure
// is fine.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

async function main() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const stripe = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });

  const rows = await db
    .select({
      id: tenants.id,
      stripeSubscriptionId: tenants.stripeSubscriptionId,
    })
    .from(tenants)
    .where(isNotNull(tenants.stripeSubscriptionId));

  let reconciled = 0;
  let drift = 0;
  let missing = 0;

  for (const row of rows) {
    const subId = row.stripeSubscriptionId;
    if (!subId) continue;
    try {
      const sub = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price"] });
      const item = sub.items.data[0];
      const plan = planFromPrice(item?.price);
      const status = statusFromStripe(sub.status);
      const currentPeriodEnd = new Date(sub.current_period_end * 1000);
      const seats = item?.quantity ?? 0;

      const result = await db
        .update(tenants)
        .set({
          plan,
          status,
          currentPeriodEnd,
          seatsPurchased: seats,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, row.id))
        .returning({ id: tenants.id });
      if (result.length > 0) drift += 1;
      reconciled += 1;
    } catch (err: any) {
      if (err?.code === "resource_missing") {
        missing += 1;
        continue;
      }
      console.error(`[reconcile] failed for ${row.id} (${subId}):`, err);
    }
  }

  console.log(
    `[reconcile] done — checked=${reconciled}, updated=${drift}, missing_in_stripe=${missing}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[reconcile] fatal:", err);
  process.exit(1);
});
