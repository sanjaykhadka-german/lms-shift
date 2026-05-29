import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import {
  lmsAssignments,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import type { LearnerContext } from "~/lib/lms/learner";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export interface AdminAssignmentRow {
  id: number;
  moduleId: number;
  moduleTitle: string;
  userId: number;
  userName: string;
  userEmail: string;
  assignedAt: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  departmentName: string | null;
}

export interface AdminAssignmentRecentRow {
  id: number;
  moduleTitle: string;
  userName: string;
  assignedAt: Date | null;
}

/** Assignment table for /app/admin/assignments. In Audit Mode, hides
 *  any assignment that hasn't been completed yet — incomplete, overdue,
 *  and due-soon rows all collapse into "nothing to see here". The
 *  completion counters in the page header recompute over the filtered
 *  set as a direct consequence. */
export async function listAdminAssignments(ctx: LearnerContext): Promise<AdminAssignmentRow[]> {
  const tid = ctx.traceyTenantId;
  const hideIncomplete =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideIncompleteAssignments;
  const where = hideIncomplete
    ? and(tenantWhere(lmsAssignments, tid), isNotNull(lmsAssignments.completedAt))
    : tenantWhere(lmsAssignments, tid);
  return ctx.db.run((tx) =>
    tx
      .select({
        id: lmsAssignments.id,
        moduleId: lmsAssignments.moduleId,
        moduleTitle: lmsModules.title,
        userId: lmsAssignments.userId,
        userName: lmsUsers.name,
        userEmail: lmsUsers.email,
        assignedAt: lmsAssignments.assignedAt,
        dueAt: lmsAssignments.dueAt,
        completedAt: lmsAssignments.completedAt,
        departmentName: lmsDepartments.name,
      })
      .from(lmsAssignments)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .where(where)
      .orderBy(asc(lmsModules.title), asc(lmsUsers.name)),
  );
}

export async function listRecentAdminAssignments(
  ctx: LearnerContext,
  limit = 5,
): Promise<AdminAssignmentRecentRow[]> {
  const tid = ctx.traceyTenantId;
  const hideIncomplete =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideIncompleteAssignments;
  const where = hideIncomplete
    ? and(tenantWhere(lmsAssignments, tid), isNotNull(lmsAssignments.completedAt))
    : tenantWhere(lmsAssignments, tid);
  return ctx.db.run((tx) =>
    tx
      .select({
        id: lmsAssignments.id,
        moduleTitle: lmsModules.title,
        userName: lmsUsers.name,
        assignedAt: lmsAssignments.assignedAt,
      })
      .from(lmsAssignments)
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
      .where(where)
      .orderBy(desc(lmsAssignments.assignedAt))
      .limit(limit),
  );
}
