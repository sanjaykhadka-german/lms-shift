import "server-only";
import { eq } from "drizzle-orm";
import { lmsUsers, type LmsUser } from "@tracey/db";
import type { LearnerContext } from "~/lib/lms/learner";
import { employeeStatus } from "~/lib/lms/employee-status";

/** The employee directory (`/app/admin/employees`) intentionally shows
 *  every employee regardless of Audit Mode — the admin still needs to
 *  see who's terminated. This helper is for the *compliance population*:
 *  the set whose assignments roll into the completion-rate denominator.
 *  In Audit Mode, drop disabled and terminated employees from that set
 *  so the headline number isn't dragged down by people who legitimately
 *  shouldn't have been completing modules anyway. */
export async function listEmployeesForCompliance(
  ctx: LearnerContext,
): Promise<Pick<LmsUser, "id" | "name" | "email" | "isActiveFlag" | "terminationDate" | "departmentId">[]> {
  const rows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        isActiveFlag: lmsUsers.isActiveFlag,
        terminationDate: lmsUsers.terminationDate,
        departmentId: lmsUsers.departmentId,
      })
      .from(lmsUsers)
      .where(eq(lmsUsers.traceyTenantId, ctx.traceyTenantId)),
  );
  const hideInactive =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideInactiveEmployees;
  if (!hideInactive) return rows;
  return rows.filter((r) => employeeStatus(r) === "active");
}
