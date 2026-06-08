// Phase 7a — per-tenant migration runner.
//
// Walks every row in `app.tenants`, ensures each one has a per-tenant
// schema (`tenant_<uuid>`) provisioned with the baseline DDL, and applies
// any later per-tenant migrations that haven't yet been recorded in
// `app.tenant_migrations`.
//
// Idempotent + resumable. If migration X fails on tenant N, the runner
// records nothing for that tenant (the failed transaction rolls back),
// and the next invocation picks up exactly there. Tenants 1..N-1 are not
// re-run because the ledger already has their entries.
//
// CLI:
//   pnpm db:migrate-tenants           # apply unapplied migrations
//   pnpm db:migrate-tenants --dry-run # show what would run, no changes

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  BASELINE_MIGRATION_NAME,
  provisionSql,
  tenantSchemaName,
} from "./per-tenant-schema";
// Single source of truth for the ordered migration list, shared with the
// in-app provisioning path (per-tenant-provision.ts → provisionTenantFull).
// Inlined from migrations/per-tenant/*.sql at codegen time
// (pnpm -F @tracey/db db:generate-per-tenant-sql) so the same SQL runs
// whether applied by this CLI or by a self-service workspace signup.
// The baseline (`0006_baseline`) is still generated in-memory by
// provisionSql() — the tenant UUID has to be interpolated.
import { PER_TENANT_MIGRATIONS } from "./per-tenant-migrations.generated";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[per-tenant-migrate] dry-run — no changes will be made");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(sql);

  // List every tenant. The runner doesn't care about plan/status — even a
  // canceled tenant gets its schema kept in sync; deletion is the only
  // way to remove a tenant schema.
  const tenants = (await db.execute(
    drizzleSql`SELECT id::text AS id, slug FROM app.tenants ORDER BY created_at`,
  )) as unknown as Array<{ id: string; slug: string }>;

  const migrations = PER_TENANT_MIGRATIONS;

  let provisioned = 0;
  let migrationsRun = 0;

  for (const tenant of tenants) {
    const schema = tenantSchemaName(tenant.id);

    // Check the ledger: does the baseline already exist?
    const ledger = (await db.execute(
      drizzleSql`SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = ${tenant.id}`,
    )) as unknown as Array<{ migration_name: string }>;
    const applied = new Set(ledger.map((r) => r.migration_name));

    if (!applied.has(BASELINE_MIGRATION_NAME)) {
      console.log(`[per-tenant-migrate] ${tenant.slug} (${tenant.id}) — provisioning baseline schema ${schema}`);
      if (!dryRun) {
        const stmts = provisionSql(tenant.id);
        await db.transaction(async (tx) => {
          for (const stmt of stmts) {
            await tx.execute(drizzleSql.raw(stmt));
          }
          await tx.execute(
            drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenant.id}, ${BASELINE_MIGRATION_NAME}) ON CONFLICT DO NOTHING`,
          );
        });
        provisioned += 1;
      }
    }

    // Apply any disk-backed per-tenant migrations not yet recorded.
    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      console.log(`[per-tenant-migrate] ${tenant.slug} (${tenant.id}) — applying ${m.name}`);
      if (!dryRun) {
        await db.transaction(async (tx) => {
          // Set search_path so unqualified table names in the migration
          // file resolve to this tenant's schema. Per-tenant migration
          // files SHOULD use unqualified names; that's what makes them
          // reusable across all tenants. `app` deliberately omitted —
          // see the long comment in client.ts forTenant() about why.
          await tx.execute(
            drizzleSql.raw(`SET LOCAL search_path = "${schema}", public`),
          );
          // Set app.tenant_id so any INSERT/UPDATE inside the migration
          // satisfies the tenant_isolation RLS policy and so the same
          // SQL can derive tracey_tenant_id via current_setting().
          await tx.execute(
            drizzleSql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`,
          );
          await tx.execute(drizzleSql.raw(m.sql));
          await tx.execute(
            drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenant.id}, ${m.name}) ON CONFLICT DO NOTHING`,
          );
        });
        migrationsRun += 1;
      }
    }
  }

  console.log(
    `[per-tenant-migrate] done — ${tenants.length} tenants scanned, ${provisioned} baselines provisioned, ${migrationsRun} additional migrations applied`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error("[per-tenant-migrate] failed:", err);
  process.exit(1);
});
