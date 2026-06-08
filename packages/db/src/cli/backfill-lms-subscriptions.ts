// Backfill: copy each tenant's legacy billing columns (on app.tenants) into
// an app='lms' row in app.tenant_subscriptions.
//
// Idempotent: ON CONFLICT (tenant_id, app) DO NOTHING — re-running never
// clobbers a row that the webhook may have already updated. Operator-applied
// on prod AFTER the 0008 migration creates the table, BEFORE lms-web is
// switched to read from tenant_subscriptions.
//
//   pnpm -F @tracey/db backfill-lms-subscriptions           # apply
//   pnpm -F @tracey/db backfill-lms-subscriptions --dry-run # preview counts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/cli/ → repo root is four levels up (cli → src → db → packages → root).
loadEnv({ path: path.resolve(here, "..", "..", "..", "..", ".env") });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const dryRun = process.argv.includes("--dry-run");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  const tenantsRows = (await db.execute(
    drizzleSql`SELECT count(*)::int AS tenants_total FROM app.tenants`,
  )) as unknown as Array<{ tenants_total: number }>;
  const tenants_total = tenantsRows[0]?.tenants_total ?? 0;

  const existingRows = (await db.execute(
    drizzleSql`SELECT count(*)::int AS already FROM app.tenant_subscriptions WHERE app = 'lms'`,
  )) as unknown as Array<{ already: number }>;
  const already = existingRows[0]?.already ?? 0;

  console.log(
    `[backfill-lms-subscriptions] tenants=${tenants_total}, existing app='lms' rows=${already}${dryRun ? " (dry-run)" : ""}`,
  );

  if (dryRun) {
    const wouldRows = (await db.execute(
      drizzleSql`
        SELECT count(*)::int AS would_insert
        FROM app.tenants t
        WHERE NOT EXISTS (
          SELECT 1 FROM app.tenant_subscriptions s
          WHERE s.tenant_id = t.id AND s.app = 'lms'
        )`,
    )) as unknown as Array<{ would_insert: number }>;
    console.log(
      `[backfill-lms-subscriptions] would insert ${wouldRows[0]?.would_insert ?? 0} row(s)`,
    );
    await sql.end();
    return;
  }

  const result = (await db.execute(
    drizzleSql`
      INSERT INTO app.tenant_subscriptions (
        tenant_id, app, plan, status, trial_ends_at, current_period_end,
        cancel_at_period_end, canceled_at, stripe_customer_id,
        stripe_subscription_id, seats_purchased, created_at, updated_at
      )
      SELECT
        t.id, 'lms', t.plan, t.status, t.trial_ends_at, t.current_period_end,
        t.cancel_at_period_end, t.canceled_at, t.stripe_customer_id,
        t.stripe_subscription_id, t.seats_purchased, t.created_at, now()
      FROM app.tenants t
      ON CONFLICT (tenant_id, app) DO NOTHING`,
  )) as unknown as { count: number };

  console.log(
    `[backfill-lms-subscriptions] inserted ${result.count ?? "?"} app='lms' subscription row(s)`,
  );
  await sql.end();
}

main().catch((err) => {
  console.error("[backfill-lms-subscriptions] failed:", err);
  process.exit(1);
});
