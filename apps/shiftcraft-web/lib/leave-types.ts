import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { forTenant, scLeaveTypes, type ScLeaveType } from "@tracey/db";

// ─── Per-tenant leave-type lookups (AUDIT.md #6) ────────────────────────
//
// The catalogue lives in tenant schemas (sc_leave_types), seeded with five
// AU-standard defaults on first migration. App code queries by slug to
// avoid hard-coding UUIDs — the seed migration guarantees these slugs
// exist for every tenant.

export interface LeaveTypeOption {
  id: string;
  slug: string;
  name: string;
  isArchived: boolean;
  sortOrder: number;
}

export async function listActiveLeaveTypes(
  tenantId: string,
): Promise<LeaveTypeOption[]> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scLeaveTypes.id,
        slug: scLeaveTypes.slug,
        name: scLeaveTypes.name,
        isArchived: scLeaveTypes.isArchived,
        sortOrder: scLeaveTypes.sortOrder,
      })
      .from(scLeaveTypes)
      .where(
        and(
          eq(scLeaveTypes.traceyTenantId, tenantId),
          eq(scLeaveTypes.isArchived, false),
        ),
      )
      .orderBy(asc(scLeaveTypes.sortOrder), asc(scLeaveTypes.name)),
  );
  return rows;
}

export async function listAllLeaveTypes(
  tenantId: string,
): Promise<ScLeaveType[]> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scLeaveTypes)
      .where(eq(scLeaveTypes.traceyTenantId, tenantId))
      .orderBy(asc(scLeaveTypes.sortOrder), asc(scLeaveTypes.name)),
  );
}

export async function findLeaveTypeBySlug(
  tenantId: string,
  slug: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scLeaveTypes.id, name: scLeaveTypes.name })
      .from(scLeaveTypes)
      .where(
        and(
          eq(scLeaveTypes.traceyTenantId, tenantId),
          eq(scLeaveTypes.slug, slug),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

// Slug derivation for admin-created custom types. Lowercases, replaces
// runs of non-alphanumeric chars with underscore, trims leading/trailing
// underscores, and falls back to "type_<random>" if the input has no
// alphanumeric chars (matching the check-constraint
// `^[a-z][a-z0-9_]*$`). The admin layer further enforces tenant-unique
// slugs at insert time via the existing unique index.

export function deriveSlugFromName(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned.length < 2 || !/^[a-z]/.test(cleaned)) {
    return `type_${Math.random().toString(36).slice(2, 8)}`;
  }
  return cleaned.slice(0, 40);
}

// The 'restrict' FK on sc_time_off_requests.leave_type_id blocks DELETE
// outright when in use — admins archive instead. This helper short-
// circuits the friendlier check.
export async function isLeaveTypeInUse(
  tenantId: string,
  leaveTypeId: string,
): Promise<boolean> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx.execute(
      sql`SELECT 1 AS one FROM sc_time_off_requests WHERE tracey_tenant_id = ${tenantId} AND leave_type_id = ${leaveTypeId} LIMIT 1`,
    ),
  );
  return !!row;
}
