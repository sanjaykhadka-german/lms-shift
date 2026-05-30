import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  forTenant,
  lmsAssignments,
  lmsDepartments,
  lmsUsers,
} from "@tracey/db";

export interface DepartmentReportRow {
  departmentId: number | null;
  departmentName: string;
  employees: number;
  assigned: number;
  completed: number;
  overdue: number;
  completionPct: number; // 0–100, one decimal
}

/**
 * Per-department training-completion rollup over ACTIVE employees: headcount,
 * total assignments, completed, overdue, and completion %. Assignment-based
 * (distinct from the dashboard's attempt pass-rate chart). Employees with no
 * department roll up under "No department".
 */
export async function departmentCompletionReport(
  traceyTenantId: string,
): Promise<DepartmentReportRow[]> {
  const tid = traceyTenantId;
  const tdb = forTenant(tid);

  const [depts, headcounts, aggregates] = await Promise.all([
    tdb.run((tx) =>
      tx
        .select({ id: lmsDepartments.id, name: lmsDepartments.name })
        .from(lmsDepartments)
        .where(eq(lmsDepartments.traceyTenantId, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    tdb.run((tx) =>
      tx
        .select({
          departmentId: lmsUsers.departmentId,
          employees: sql<number>`count(*)::int`,
        })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.traceyTenantId, tid), eq(lmsUsers.isActiveFlag, true)))
        .groupBy(lmsUsers.departmentId),
    ),
    tdb.run((tx) =>
      tx
        .select({
          departmentId: lmsUsers.departmentId,
          assigned: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${lmsAssignments.completedAt} is not null)::int`,
          overdue: sql<number>`count(*) filter (where ${lmsAssignments.completedAt} is null and ${lmsAssignments.dueAt} is not null and ${lmsAssignments.dueAt} < now())::int`,
        })
        .from(lmsAssignments)
        .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
        .where(
          and(eq(lmsAssignments.traceyTenantId, tid), eq(lmsUsers.isActiveFlag, true)),
        )
        .groupBy(lmsUsers.departmentId),
    ),
  ]);

  const nameById = new Map(depts.map((d) => [d.id, d.name]));
  const headByDept = new Map(headcounts.map((h) => [h.departmentId, h.employees]));
  const aggByDept = new Map(aggregates.map((a) => [a.departmentId, a]));

  // Union of all department ids that appear in either headcounts or aggregates.
  const ids = new Set<number | null>();
  for (const h of headcounts) ids.add(h.departmentId);
  for (const a of aggregates) ids.add(a.departmentId);

  const rows: DepartmentReportRow[] = Array.from(ids).map((id) => {
    const agg = aggByDept.get(id);
    const assigned = agg?.assigned ?? 0;
    const completed = agg?.completed ?? 0;
    return {
      departmentId: id,
      departmentName: id == null ? "No department" : nameById.get(id) ?? `#${id}`,
      employees: headByDept.get(id) ?? 0,
      assigned,
      completed,
      overdue: agg?.overdue ?? 0,
      completionPct: assigned === 0 ? 0 : Math.round((completed * 1000) / assigned) / 10,
    };
  });

  rows.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return rows;
}
