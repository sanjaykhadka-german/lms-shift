import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  forTenant,
  lmsAssignments,
  lmsAttempts,
  lmsDepartments,
  lmsModules,
  lmsUsers,
  type AuditModeSettings,
} from "@tracey/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 7;
const EXPIRING_DAYS = 30;
const TOP_N = 10;

export type DashboardFilters = {
  tid: string;
  from: Date;
  to: Date;
  deptId: number | null;
  moduleId: number | null;
  /** Workspace-level Audit Mode master switch. Each `auditSettings.hideX`
   *  sub-toggle only fires when this is true. KPIs recompute over the
   *  filtered set — by construction completionPct becomes 100% when
   *  `hideIncompleteAssignments` is on. The page labels affected cards
   *  "Audit view" so the consistency is visible. */
  auditMode: boolean;
  auditSettings: AuditModeSettings;
};

export type AssignmentStatus = "completed" | "overdue" | "due_soon" | "open";

export type DashboardModel = {
  filters: DashboardFilters;
  // Window KPIs (filtered by from..to + scope)
  attemptsInWindow: number;
  passRate: number; // 0..1
  avgScore: number;
  activeLearners: number;
  // Compliance KPIs (over current scope, not window)
  overdue: number;
  expiring30d: number;
  completionPct: number; // 0..1
  usersNeedingRetrain: number;
  totalAssignments: number;
  completedAssignments: number;
  // Charts
  timeseries: Array<{ date: string; passed: number; failed: number }>;
  assignmentStatus: { completed: number; overdue: number; dueSoon: number; open: number };
  passRateByModule: Array<{
    moduleId: number;
    title: string;
    attempts: number;
    passRate: number;
  }>;
  passRateByDept: Array<{
    deptId: number;
    name: string;
    attempts: number;
    passRate: number;
  }>;
  // Tables
  topLearners: Array<{
    userId: number;
    name: string;
    attempts: number;
    avgScore: number;
    passRate: number;
  }>;
  problemModules: Array<{
    moduleId: number;
    title: string;
    attempts: number;
    passRate: number;
  }>;
  usersNeedingRetrainList: Array<{
    userId: number;
    name: string;
    overdueCount: number;
    expiringCount: number;
  }>;
  recentAttempts: Array<{
    id: number;
    userName: string;
    moduleTitle: string;
    score: number;
    passed: boolean;
    createdAt: Date;
  }>;
};

export type LatestAttemptCell = { passed: boolean; passedAt: Date | null };

/**
 * Latest attempt per (userId, moduleId) in the tenant. Used by the matrix
 * for pass/fail/not-yet cell semantics. `passedAt` is the latest attempt's
 * `created_at` and is only populated for passed cells.
 */
export async function latestAttemptsByUserModule(
  tid: string,
  opts: { auditMode?: boolean } = {},
): Promise<Map<number, Map<number, LatestAttemptCell>>> {
  // Audit Mode: only consider passing attempts when computing the
  // "latest" row. A user with a recent failed attempt then appears as
  // either their last passing attempt (clean) or "not yet attempted"
  // (cell renders as empty), instead of a red ❌.
  const innerWhere = opts.auditMode
    ? sql`tracey_tenant_id = ${tid} and passed = true`
    : sql`tracey_tenant_id = ${tid}`;
  const rows = (await forTenant(tid).run((tx) =>
    tx.execute(sql`
    select user_id, module_id, passed, created_at
    from (
      select user_id, module_id, passed, created_at,
             row_number() over (partition by user_id, module_id order by created_at desc) as rn
      from attempts
      where ${innerWhere}
    ) t
    where rn = 1
  `),
  )) as unknown as Array<{
    user_id: number;
    module_id: number;
    passed: boolean | null;
    created_at: string | Date | null;
  }>;

  const out = new Map<number, Map<number, LatestAttemptCell>>();
  for (const r of rows) {
    let inner = out.get(r.user_id);
    if (!inner) {
      inner = new Map();
      out.set(r.user_id, inner);
    }
    const passed = r.passed === true;
    const passedAt =
      passed && r.created_at
        ? r.created_at instanceof Date
          ? r.created_at
          : new Date(r.created_at)
        : null;
    inner.set(r.module_id, { passed, passedAt });
  }
  return out;
}

export async function buildDashboardModel(
  f: DashboardFilters,
): Promise<DashboardModel> {
  // All five queries share a single tenant-scoped transaction so RLS sees
  // `app.tenant_id` once and queries can run sequentially / in parallel
  // against the same connection without re-establishing the GUC.
  const userScope = f.deptId != null;
  // Per-feature predicate booleans — each fires only when the master and the
  // matching sub-toggle are both on. Precomputed here so the query branches
  // below stay readable.
  const hideInactive = f.auditMode && f.auditSettings.hideInactiveEmployees;
  const hideUnpublished = f.auditMode && f.auditSettings.hideUnpublishedModules;
  const hideFailed = f.auditMode && f.auditSettings.hideFailedAttempts;
  const hideIncomplete = f.auditMode && f.auditSettings.hideIncompleteAssignments;
  const { userRows, deptRows, moduleRows, windowAttempts, scopedAssignments, recentRows } =
    await forTenant(f.tid).run(async (tx) => {
      // 1) Resolve scoped users (always — we need names + dept for charts/tables).
      const userFilters = [eq(lmsUsers.traceyTenantId, f.tid)];
      if (f.deptId != null) userFilters.push(eq(lmsUsers.departmentId, f.deptId));
      if (hideInactive) {
        // Drop disabled / terminated employees from the compliance population.
        userFilters.push(eq(lmsUsers.isActiveFlag, true));
        userFilters.push(
          sql`(${lmsUsers.terminationDate} is null or ${lmsUsers.terminationDate} >= current_date)`,
        );
      }
      const userRows = await tx
        .select({
          id: lmsUsers.id,
          name: lmsUsers.name,
          departmentId: lmsUsers.departmentId,
          isActive: lmsUsers.isActiveFlag,
        })
        .from(lmsUsers)
        .where(and(...userFilters));
      const scopedUserIds = userRows.map((u) => u.id);

      // 2) Departments + modules (for charting joins).
      const moduleFilters = [eq(lmsModules.traceyTenantId, f.tid)];
      if (hideUnpublished) moduleFilters.push(eq(lmsModules.isPublished, true));
      const [deptRows, moduleRows] = await Promise.all([
        tx
          .select({ id: lmsDepartments.id, name: lmsDepartments.name })
          .from(lmsDepartments)
          .where(eq(lmsDepartments.traceyTenantId, f.tid)),
        tx
          .select({
            id: lmsModules.id,
            title: lmsModules.title,
            validForDays: lmsModules.validForDays,
          })
          .from(lmsModules)
          .where(and(...moduleFilters)),
      ]);

      // 3) Attempts in window — fetch full rows then aggregate in JS.
      const attemptWindowFilters = [
        eq(lmsAttempts.traceyTenantId, f.tid),
        gte(lmsAttempts.createdAt, f.from),
        lt(lmsAttempts.createdAt, f.to),
      ];
      if (f.moduleId != null) {
        attemptWindowFilters.push(eq(lmsAttempts.moduleId, f.moduleId));
      }
      if (userScope) {
        if (scopedUserIds.length === 0) {
          attemptWindowFilters.push(sql`false`);
        } else {
          attemptWindowFilters.push(inArray(lmsAttempts.userId, scopedUserIds));
        }
      }
      if (hideFailed) attemptWindowFilters.push(eq(lmsAttempts.passed, true));
      const windowAttempts = await tx
        .select({
          id: lmsAttempts.id,
          userId: lmsAttempts.userId,
          moduleId: lmsAttempts.moduleId,
          passed: lmsAttempts.passed,
          score: lmsAttempts.score,
          createdAt: lmsAttempts.createdAt,
        })
        .from(lmsAttempts)
        .where(and(...attemptWindowFilters));

      // 4) Assignments in scope (no time window — compliance is point-in-time).
      const assignmentFilters = [eq(lmsAssignments.traceyTenantId, f.tid)];
      if (f.moduleId != null) {
        assignmentFilters.push(eq(lmsAssignments.moduleId, f.moduleId));
      }
      if (userScope) {
        if (scopedUserIds.length === 0) {
          assignmentFilters.push(sql`false`);
        } else {
          assignmentFilters.push(inArray(lmsAssignments.userId, scopedUserIds));
        }
      } else if (hideInactive) {
        // Even without dept scope, the inactive-employee filter must
        // restrict assignments to the active-employee user set computed
        // above. Otherwise an assignment owned by a terminated employee
        // would still count.
        if (scopedUserIds.length === 0) {
          assignmentFilters.push(sql`false`);
        } else {
          assignmentFilters.push(inArray(lmsAssignments.userId, scopedUserIds));
        }
      }
      if (hideIncomplete) assignmentFilters.push(isNotNull(lmsAssignments.completedAt));
      const scopedAssignments = await tx
        .select({
          id: lmsAssignments.id,
          userId: lmsAssignments.userId,
          moduleId: lmsAssignments.moduleId,
          dueAt: lmsAssignments.dueAt,
          completedAt: lmsAssignments.completedAt,
        })
        .from(lmsAssignments)
        .where(and(...assignmentFilters));

      // 5) Recent attempts (last 10, all-time, scope-aware).
      const recentFilters = [eq(lmsAttempts.traceyTenantId, f.tid)];
      if (f.moduleId != null) recentFilters.push(eq(lmsAttempts.moduleId, f.moduleId));
      if (userScope) {
        if (scopedUserIds.length === 0) recentFilters.push(sql`false`);
        else recentFilters.push(inArray(lmsAttempts.userId, scopedUserIds));
      } else if (hideInactive) {
        if (scopedUserIds.length === 0) recentFilters.push(sql`false`);
        else recentFilters.push(inArray(lmsAttempts.userId, scopedUserIds));
      }
      if (hideFailed) recentFilters.push(eq(lmsAttempts.passed, true));
      const recentRows = await tx
        .select({
          id: lmsAttempts.id,
          userId: lmsAttempts.userId,
          moduleId: lmsAttempts.moduleId,
          score: lmsAttempts.score,
          passed: lmsAttempts.passed,
          createdAt: lmsAttempts.createdAt,
          userName: lmsUsers.name,
          moduleTitle: lmsModules.title,
        })
        .from(lmsAttempts)
        .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAttempts.userId))
        .innerJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
        .where(and(...recentFilters, isNotNull(lmsAttempts.createdAt)))
        .orderBy(desc(lmsAttempts.createdAt))
        .limit(10);

      return { userRows, deptRows, moduleRows, windowAttempts, scopedAssignments, recentRows };
    });

  const userById = new Map(userRows.map((u) => [u.id, u]));
  const scopedUserIds = userRows.map((u) => u.id);
  void scopedUserIds;
  const deptById = new Map(deptRows.map((d) => [d.id, d]));
  const moduleById = new Map(moduleRows.map((m) => [m.id, m]));

  // ---------- Aggregations ----------
  const attemptsInWindow = windowAttempts.length;
  let passed = 0;
  let totalScore = 0;
  let scoreCount = 0;
  const learnerSet = new Set<number>();
  const dailyMap = new Map<string, { passed: number; failed: number }>();
  // module rate (window)
  const moduleAgg = new Map<number, { attempts: number; passed: number }>();
  // dept rate (window)
  const deptAgg = new Map<number, { attempts: number; passed: number }>();
  // learner rate (window)
  const learnerAgg = new Map<
    number,
    { attempts: number; passed: number; scoreSum: number }
  >();

  for (const a of windowAttempts) {
    const isPass = a.passed === true;
    if (isPass) passed += 1;
    if (typeof a.score === "number") {
      totalScore += a.score;
      scoreCount += 1;
    }
    learnerSet.add(a.userId);

    const day = a.createdAt
      ? a.createdAt.toISOString().slice(0, 10)
      : "unknown";
    const dEntry = dailyMap.get(day) ?? { passed: 0, failed: 0 };
    if (isPass) dEntry.passed += 1;
    else dEntry.failed += 1;
    dailyMap.set(day, dEntry);

    const mEntry = moduleAgg.get(a.moduleId) ?? { attempts: 0, passed: 0 };
    mEntry.attempts += 1;
    if (isPass) mEntry.passed += 1;
    moduleAgg.set(a.moduleId, mEntry);

    const learnerDept = userById.get(a.userId)?.departmentId ?? null;
    if (learnerDept != null) {
      const dE = deptAgg.get(learnerDept) ?? { attempts: 0, passed: 0 };
      dE.attempts += 1;
      if (isPass) dE.passed += 1;
      deptAgg.set(learnerDept, dE);
    }

    const lEntry = learnerAgg.get(a.userId) ?? {
      attempts: 0,
      passed: 0,
      scoreSum: 0,
    };
    lEntry.attempts += 1;
    if (isPass) lEntry.passed += 1;
    lEntry.scoreSum += typeof a.score === "number" ? a.score : 0;
    learnerAgg.set(a.userId, lEntry);
  }

  const passRate = attemptsInWindow > 0 ? passed / attemptsInWindow : 0;
  const avgScore = scoreCount > 0 ? totalScore / scoreCount : 0;

  // Timeseries — fill missing days for a continuous chart.
  const timeseries: Array<{ date: string; passed: number; failed: number }> = [];
  for (
    let d = startOfDay(f.from).getTime();
    d < f.to.getTime();
    d += MS_PER_DAY
  ) {
    const day = new Date(d).toISOString().slice(0, 10);
    const entry = dailyMap.get(day) ?? { passed: 0, failed: 0 };
    timeseries.push({ date: day, ...entry });
  }

  // Compliance — bucket scoped assignments.
  const now = Date.now();
  const expiringCutoff = now + EXPIRING_DAYS * MS_PER_DAY;
  const dueSoonCutoff = now + DUE_SOON_DAYS * MS_PER_DAY;
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  let open = 0;
  let expiring = 0;
  const overdueByUser = new Map<number, number>();
  const expiringByUser = new Map<number, number>();
  for (const a of scopedAssignments) {
    if (a.completedAt) {
      completed += 1;
      // Check expiry.
      const m = moduleById.get(a.moduleId);
      if (m?.validForDays && m.validForDays > 0) {
        const expiresAt = a.completedAt.getTime() + m.validForDays * MS_PER_DAY;
        if (expiresAt > now && expiresAt <= expiringCutoff) {
          expiring += 1;
          expiringByUser.set(
            a.userId,
            (expiringByUser.get(a.userId) ?? 0) + 1,
          );
        }
      }
    } else if (a.dueAt) {
      const t = a.dueAt.getTime();
      if (t < now) {
        overdue += 1;
        overdueByUser.set(a.userId, (overdueByUser.get(a.userId) ?? 0) + 1);
      } else if (t < dueSoonCutoff) {
        dueSoon += 1;
      } else {
        open += 1;
      }
    } else {
      open += 1;
    }
  }
  const totalAssignments = scopedAssignments.length;
  const completionPct = totalAssignments > 0 ? completed / totalAssignments : 0;
  const usersNeedingSet = new Set<number>([
    ...overdueByUser.keys(),
    ...expiringByUser.keys(),
  ]);

  // Pass rate by module — worst-first, top N.
  const passRateByModule = [...moduleAgg.entries()]
    .filter(([, v]) => v.attempts >= 1)
    .map(([mid, v]) => ({
      moduleId: mid,
      title: moduleById.get(mid)?.title ?? `Module ${mid}`,
      attempts: v.attempts,
      passRate: v.attempts > 0 ? v.passed / v.attempts : 0,
    }))
    .sort((a, b) => a.passRate - b.passRate || b.attempts - a.attempts)
    .slice(0, TOP_N);

  const passRateByDept = [...deptAgg.entries()]
    .map(([did, v]) => ({
      deptId: did,
      name: deptById.get(did)?.name ?? `Dept ${did}`,
      attempts: v.attempts,
      passRate: v.attempts > 0 ? v.passed / v.attempts : 0,
    }))
    .sort((a, b) => b.passRate - a.passRate);

  const topLearners = [...learnerAgg.entries()]
    .filter(([, v]) => v.attempts >= 3)
    .map(([uid, v]) => ({
      userId: uid,
      name: userById.get(uid)?.name ?? `User ${uid}`,
      attempts: v.attempts,
      avgScore: v.attempts > 0 ? v.scoreSum / v.attempts : 0,
      passRate: v.attempts > 0 ? v.passed / v.attempts : 0,
    }))
    .sort((a, b) => b.avgScore - a.avgScore || b.passRate - a.passRate)
    .slice(0, 5);

  const problemModules = passRateByModule.slice(0, 5);

  const usersNeedingRetrainList = [...usersNeedingSet]
    .map((uid) => ({
      userId: uid,
      name: userById.get(uid)?.name ?? `User ${uid}`,
      overdueCount: overdueByUser.get(uid) ?? 0,
      expiringCount: expiringByUser.get(uid) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.overdueCount + b.expiringCount - (a.overdueCount + a.expiringCount),
    )
    .slice(0, 10);

  return {
    filters: f,
    attemptsInWindow,
    passRate,
    avgScore,
    activeLearners: learnerSet.size,
    overdue,
    expiring30d: expiring,
    completionPct,
    usersNeedingRetrain: usersNeedingSet.size,
    totalAssignments,
    completedAssignments: completed,
    timeseries,
    assignmentStatus: { completed, overdue, dueSoon, open },
    passRateByModule,
    passRateByDept,
    topLearners,
    problemModules,
    usersNeedingRetrainList,
    recentAttempts: recentRows.map((r) => ({
      id: r.id,
      userName: r.userName,
      moduleTitle: r.moduleTitle,
      score: r.score ?? 0,
      passed: r.passed === true,
      createdAt: r.createdAt!,
    })),
  };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
