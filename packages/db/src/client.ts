import { drizzle } from "drizzle-orm/postgres-js";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForPostgres = globalThis as unknown as {
  __traceyPostgres?: postgres.Sql;
};

const sql =
  globalForPostgres.__traceyPostgres ??
  postgres(databaseUrl, {
    max: 10,
    // Required for Supabase's transaction-mode pooler (port 6543): PgBouncer
    // in transaction mode does not support prepared statements.
    prepare: false,
    idle_timeout: 30,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPostgres.__traceyPostgres = sql;
}

export const db = drizzle(sql, { schema, logger: process.env.NODE_ENV === "development" });
export { sql as pg };
export * from "./schema";

// ─── Tenant scoping (row-per-tenant isolation) ────
//
// `forTenant(tid)` returns a transaction runner that, at the start of every
// transaction it opens, runs:
//
//   SELECT set_config('app.tenant_id', <tid>, true)
//
// Postgres RLS policies (migrations/manual/0001_enable_rls.sql) read this GUC
// to enforce per-tenant row visibility on the shared `lms_*` / `sc_*` tables:
//
//   USING (tracey_tenant_id = current_setting('app.tenant_id', true)::uuid)
//
// So even a query that forgets its `WHERE tracey_tenant_id = …` filter cannot
// leak across tenants. The GUC is transaction-local (`true`) → cleared on
// COMMIT/ROLLBACK, which is safe under Supabase's transaction-mode pooler:
// the whole transaction is pinned to one backend, so the GUC and every query
// inside `run()` share the same connection. A tenant-scoped query issued
// OUTSIDE `run()` has no GUC set and (RLS forced) returns zero rows — the
// desired fail-closed behaviour.
//
// Usage:
//   const ctx = await requireAdmin();          // attaches ctx.db
//   const rows = await ctx.db.run((tx) =>
//     tx.select().from(lmsDepartments).where(...),
//   );

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TenantDb {
  readonly tenantId: string;
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function forTenant(tenantId: string): TenantDb {
  return {
    tenantId,
    async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(
          drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
        );
        return fn(tx);
      });
    },
  };
}
