import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { lmsModules } from "@tracey/db";
import type { LearnerContext } from "~/lib/lms/learner";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export interface AdminModuleRow {
  id: number;
  title: string;
  description: string | null;
  isPublished: boolean | null;
  createdAt: Date | null;
}

/** Module catalogue for /app/admin/modules. In Audit Mode, hides
 *  unpublished modules so the catalogue looks like a clean, current
 *  library to an external auditor. The toggle defaults to false, so
 *  by default this returns every module just like the prior inline
 *  query did. */
export async function listAdminModules(ctx: LearnerContext): Promise<AdminModuleRow[]> {
  const tid = ctx.traceyTenantId;
  const hideUnpublished =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideUnpublishedModules;
  const where = hideUnpublished
    ? and(tenantWhere(lmsModules, tid), eq(lmsModules.isPublished, true))
    : tenantWhere(lmsModules, tid);
  return ctx.db.run((tx) =>
    tx
      .select({
        id: lmsModules.id,
        title: lmsModules.title,
        description: lmsModules.description,
        isPublished: lmsModules.isPublished,
        createdAt: lmsModules.createdAt,
      })
      .from(lmsModules)
      .where(where)
      .orderBy(asc(lmsModules.title)),
  );
}
