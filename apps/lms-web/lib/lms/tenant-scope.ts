import "server-only";
import { eq, type SQL } from "drizzle-orm";

// Phase 4 Slice 3 — every legacy LMS table has a `tracey_tenant_id` column
// (see packages/db/migrations/manual/0003_lms_multitenant.sql).
//
// Usage:
//   await db.select().from(lmsDepartments)
//     .where(and(eq(lmsDepartments.id, id), tenantWhere(lmsDepartments, ctx.traceyTenantId)));
//
// The Drizzle column types are messy enough that wrapping more than this
// in a helper costs more than it saves. Keep tenantWhere and let each
// callsite assemble its own AND-tree.

export function tenantWhere<T extends { traceyTenantId: unknown }>(
  table: T,
  tenantId: string,
): SQL {
  return eq((table as { traceyTenantId: unknown }).traceyTenantId as never, tenantId);
}
