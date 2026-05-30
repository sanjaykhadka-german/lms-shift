import "server-only";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  forTenant,
  lmsAssignments,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { tenantWhere } from "./tenant-scope";
import { latestAttemptsByUserModule, type LatestAttemptCell } from "./dashboard";

export interface MatrixFilters {
  dept?: number | null;
  module?: number | null;
  q?: string;
  auditMode?: boolean;
}

export interface MatrixUser {
  id: number;
  name: string;
  email: string;
  departmentId: number | null;
  departmentName: string | null;
}

export interface MatrixModule {
  id: number;
  title: string;
}

export interface TrainingMatrixData {
  departments: Array<{ id: number; name: string }>;
  allModules: MatrixModule[];
  modules: MatrixModule[]; // axis modules (after the single-module filter)
  users: MatrixUser[];
  assignmentSet: Set<string>; // `${userId}|${moduleId}`
  latest: Map<number, Map<number, LatestAttemptCell>>;
}

/**
 * Builds the training-matrix dataset (active employees × published modules,
 * with latest pass/fail + assignment state), honoring the dept/module/search
 * filters. Shared by the matrix page and its CSV export so the two never drift.
 */
export async function buildTrainingMatrix(
  tid: string,
  filters: MatrixFilters,
): Promise<TrainingMatrixData> {
  const tdb = forTenant(tid);

  const [departments, allModules] = await Promise.all([
    tdb.run((tx) =>
      tx
        .select({ id: lmsDepartments.id, name: lmsDepartments.name })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    tdb.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(and(tenantWhere(lmsModules, tid), eq(lmsModules.isPublished, true)))
        .orderBy(asc(lmsModules.title)),
    ),
  ]);

  const modules =
    filters.module != null
      ? allModules.filter((m) => m.id === filters.module)
      : allModules;

  const userFilters = [
    eq(lmsUsers.traceyTenantId, tid),
    eq(lmsUsers.isActiveFlag, true),
  ];
  if (filters.dept != null) userFilters.push(eq(lmsUsers.departmentId, filters.dept));
  const q = (filters.q ?? "").trim();
  if (q) {
    const pat = `%${q}%`;
    const orExpr = or(ilike(lmsUsers.name, pat), ilike(lmsUsers.email, pat));
    if (orExpr) userFilters.push(orExpr);
  }

  const users = await tdb.run((tx) =>
    tx
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        departmentId: lmsUsers.departmentId,
        departmentName: lmsDepartments.name,
      })
      .from(lmsUsers)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
      .where(and(...userFilters))
      .orderBy(sql`coalesce(${lmsDepartments.name}, '') asc`, asc(lmsUsers.name)),
  );

  const userIds = users.map((u) => u.id);
  const moduleIds = modules.map((m) => m.id);
  const assignmentSet = new Set<string>();
  if (userIds.length > 0 && moduleIds.length > 0) {
    const rows = await tdb.run((tx) =>
      tx
        .select({
          userId: lmsAssignments.userId,
          moduleId: lmsAssignments.moduleId,
        })
        .from(lmsAssignments)
        .where(
          and(
            eq(lmsAssignments.traceyTenantId, tid),
            inArray(lmsAssignments.userId, userIds),
            inArray(lmsAssignments.moduleId, moduleIds),
          ),
        ),
    );
    for (const r of rows) assignmentSet.add(`${r.userId}|${r.moduleId}`);
  }

  const latest = await latestAttemptsByUserModule(tid, {
    auditMode: filters.auditMode ?? false,
  });

  return { departments, allModules, modules, users, assignmentSet, latest };
}
