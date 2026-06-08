// In-app per-tenant provisioning — provisionTenantFull().
//
// Brings a single tenant's schema fully up to date in one call, using the
// app's shared `db` handle: the LMS baseline (provisionSql — 19 tables,
// FKs, RLS) plus every per-tenant migration (whs_kinds, the full sc_*
// ShiftCraft surface) that isn't yet recorded in app.tenant_migrations.
//
// This is the in-app analogue of the operator CLI per-tenant-migrate.ts.
// Both consume the same PER_TENANT_MIGRATIONS list (generated from
// migrations/per-tenant/*.sql) so there is no drift between what a
// self-service signup provisions and what `pnpm db:migrate-tenants` applies.
//
// allow-no-fortenant: this runs CREATE SCHEMA / CREATE TABLE DDL that
// cannot be wrapped in forTenant() (whose search_path points at a schema
// that does not exist yet). Each non-baseline migration sets search_path +
// app.tenant_id itself, exactly as the CLI runner does. Recognised by the
// lint allowlist in scripts/check-tenant-scope.mjs.

import { sql as drizzleSql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  BASELINE_MIGRATION_NAME,
  provisionSql,
  tenantSchemaName,
} from "./per-tenant-schema";
import { PER_TENANT_MIGRATIONS } from "./per-tenant-migrations.generated";

export interface ProvisionFullResult {
  tenantId: string;
  schema: string;
  baselineProvisioned: boolean;
  migrationsApplied: string[];
}

/**
 * Idempotent + resumable. Reads the ledger first, so re-running on an
 * already-provisioned tenant only applies migrations that are genuinely
 * missing (and is a no-op once everything is recorded). Each migration runs
 * in its own transaction: a failure rolls that one back, records nothing,
 * and a subsequent call retries exactly there.
 *
 * Throws on any DDL failure — the caller (onboarding) should surface it so
 * a half-provisioned workspace is visible rather than silently broken.
 */
export async function provisionTenantFull(
  db: PostgresJsDatabase<Record<string, unknown>>,
  tenantId: string,
): Promise<ProvisionFullResult> {
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    // tenantId is interpolated into identifiers + SQL literals; reject
    // anything that isn't a UUID before we get near a CREATE SCHEMA call.
    throw new Error(`provisionTenantFull: invalid tenantId ${JSON.stringify(tenantId)}`);
  }

  const schema = tenantSchemaName(tenantId);

  const ledgerRows = (await db.execute(
    drizzleSql`SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = ${tenantId}`,
  )) as unknown as Array<{ migration_name: string }>;
  const applied = new Set(ledgerRows.map((r) => r.migration_name));

  let baselineProvisioned = false;
  if (!applied.has(BASELINE_MIGRATION_NAME)) {
    const stmts = provisionSql(tenantId);
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(drizzleSql.raw(stmt));
      }
      await tx.execute(
        drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${BASELINE_MIGRATION_NAME}) ON CONFLICT DO NOTHING`,
      );
    });
    baselineProvisioned = true;
  }

  const migrationsApplied: string[] = [];
  for (const m of PER_TENANT_MIGRATIONS) {
    if (applied.has(m.name)) continue;
    await db.transaction(async (tx) => {
      // Unqualified table names in the migration resolve into this tenant's
      // schema; `app` is deliberately omitted (see client.ts forTenant()).
      await tx.execute(
        drizzleSql.raw(`SET LOCAL search_path = "${schema}", public`),
      );
      // INSERT/UPDATE inside the migration satisfies tenant_isolation RLS
      // and lets the SQL derive tracey_tenant_id via current_setting().
      await tx.execute(
        drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      await tx.execute(drizzleSql.raw(m.sql));
      await tx.execute(
        drizzleSql`INSERT INTO app.tenant_migrations (tenant_id, migration_name) VALUES (${tenantId}, ${m.name}) ON CONFLICT DO NOTHING`,
      );
    });
    migrationsApplied.push(m.name);
  }

  return { tenantId, schema, baselineProvisioned, migrationsApplied };
}
