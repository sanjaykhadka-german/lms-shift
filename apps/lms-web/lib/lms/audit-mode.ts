import "server-only";
import { eq } from "drizzle-orm";
import { db, tenants, AUDIT_MODE_DEFAULTS, type AuditModeSettings } from "@tracey/db";

/** One-shot fetch of `app.tenants.audit_mode` for code paths that don't
 *  already hold a `LearnerContext` (e.g. server actions that go through
 *  their own auth helpers, or background jobs that load the tenant id
 *  from elsewhere). Page server components and admin actions should read
 *  `ctx.tenantAuditMode` instead — it's already populated by
 *  `requireAdmin()` / `requireLearner()` with no extra round-trip. */
export async function getAuditMode(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ auditMode: tenants.auditMode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.auditMode ?? false;
}

/** Sibling of getAuditMode: returns the per-feature sub-toggle settings.
 *  Falls back to AUDIT_MODE_DEFAULTS if the row is missing for any reason. */
export async function getAuditModeSettings(tenantId: string): Promise<AuditModeSettings> {
  const rows = await db
    .select({ auditModeSettings: tenants.auditModeSettings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0]?.auditModeSettings ?? AUDIT_MODE_DEFAULTS;
}
