import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  lmsAssignments,
  lmsAttempts,
  lmsDepartments,
  lmsEmployers,
  lmsMachineModules,
  lmsMachines,
  lmsModules,
  lmsPositions,
  lmsUserMachines,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { formatDate as fmtDateInTz } from "~/lib/format/datetime";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { PASS_THRESHOLD } from "~/lib/site-config";

export const metadata = { title: "Employee details" };

type ModuleStatus = "passed" | "failed" | "not_attempted" | "unassigned_attempt";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = parseInt(id, 10);
  if (!Number.isFinite(userId)) notFound();

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  // Employee detail uses a single "hide failed attempts" gate. Combine the
  // master + sub-toggle once so downstream conditionals stay readable.
  const auditMode =
    ctx.tenantAuditMode && ctx.tenantAuditSettings.hideFailedAttempts;
  const formatDate = (d: Date | string): string =>
    fmtDateInTz(d, ctx.tenantTimezone, { year: "numeric", month: "short", day: "numeric" }) || "—";

  const [[user], assignments, attempts, userMachineRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          name: lmsUsers.name,
          email: lmsUsers.email,
          role: lmsUsers.role,
          phone: lmsUsers.phone,
          isActiveFlag: lmsUsers.isActiveFlag,
          jobTitle: lmsUsers.jobTitle,
          photoFilename: lmsUsers.photoFilename,
          startDate: lmsUsers.startDate,
          terminationDate: lmsUsers.terminationDate,
          departmentName: lmsDepartments.name,
          employerName: lmsEmployers.name,
          positionName: lmsPositions.name,
        })
        .from(lmsUsers)
        .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
        .leftJoin(lmsEmployers, eq(lmsEmployers.id, lmsUsers.employerId))
        .leftJoin(lmsPositions, eq(lmsPositions.id, lmsUsers.positionId))
        .where(and(eq(lmsUsers.id, userId), eq(lmsUsers.traceyTenantId, tid)))
        .limit(1),
    ),
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsAssignments.id,
          moduleId: lmsAssignments.moduleId,
          moduleTitle: lmsModules.title,
          assignedAt: lmsAssignments.assignedAt,
          dueAt: lmsAssignments.dueAt,
          completedAt: lmsAssignments.completedAt,
        })
        .from(lmsAssignments)
        .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
        .where(and(eq(lmsAssignments.userId, userId), tenantWhere(lmsAssignments, tid))),
    ),
    ctx.db.run((tx) => {
      const filters = [eq(lmsAttempts.userId, userId), tenantWhere(lmsAttempts, tid)];
      // Audit Mode: only passing attempts contribute to per-module status,
      // best score, and the Recent attempts card. Failed-attempt rows
      // disappear entirely — no red badges, no "Attempts: 4" noise.
      if (auditMode) filters.push(eq(lmsAttempts.passed, true));
      return tx
        .select({
          id: lmsAttempts.id,
          moduleId: lmsAttempts.moduleId,
          moduleTitle: lmsModules.title,
          score: lmsAttempts.score,
          passed: lmsAttempts.passed,
          createdAt: lmsAttempts.createdAt,
        })
        .from(lmsAttempts)
        .leftJoin(lmsModules, eq(lmsModules.id, lmsAttempts.moduleId))
        .where(and(...filters))
        .orderBy(desc(lmsAttempts.createdAt));
    }),
    ctx.db.run((tx) =>
      tx
        .select({
          machineId: lmsUserMachines.machineId,
          machineName: lmsMachines.name,
        })
        .from(lmsUserMachines)
        .innerJoin(lmsMachines, eq(lmsMachines.id, lmsUserMachines.machineId))
        .where(and(eq(lmsUserMachines.userId, userId), tenantWhere(lmsUserMachines, tid)))
        .orderBy(asc(lmsMachines.name)),
    ),
  ]);
  if (!user) notFound();

  // Group attempts by module. In Audit Mode the SQL already filtered to
  // passed=true, then we collapse to the most recent passing attempt per
  // module so the per-row "Attempts" count is 1 and there's no failed
  // history to render.
  const dedupedAttempts = auditMode
    ? (() => {
        const seen = new Set<number>();
        return attempts.filter((a) => {
          if (seen.has(a.moduleId)) return false;
          seen.add(a.moduleId);
          return true;
        });
      })()
    : attempts;
  const attemptsByModule = new Map<number, typeof attempts>();
  for (const a of dedupedAttempts) {
    const arr = attemptsByModule.get(a.moduleId) ?? [];
    arr.push(a);
    attemptsByModule.set(a.moduleId, arr);
  }

  interface ModuleRow {
    moduleId: number;
    moduleTitle: string;
    assigned: boolean;
    assignedAt: Date | null;
    dueAt: Date | null;
    completedAt: Date | null;
    attempts: typeof attempts;
    bestScore: number | null;
    latest: (typeof attempts)[number] | null;
    status: ModuleStatus;
  }

  const rowMap = new Map<number, ModuleRow>();
  for (const a of assignments) {
    rowMap.set(a.moduleId, {
      moduleId: a.moduleId,
      moduleTitle: a.moduleTitle,
      assigned: true,
      assignedAt: a.assignedAt,
      dueAt: a.dueAt,
      completedAt: a.completedAt,
      attempts: [],
      bestScore: null,
      latest: null,
      status: "not_attempted",
    });
  }
  for (const [mid, atts] of attemptsByModule) {
    const row = rowMap.get(mid);
    if (row) {
      row.attempts = atts;
    } else {
      rowMap.set(mid, {
        moduleId: mid,
        moduleTitle: atts[0]?.moduleTitle ?? `Module ${mid}`,
        assigned: false,
        assignedAt: null,
        dueAt: null,
        completedAt: null,
        attempts: atts,
        bestScore: null,
        latest: null,
        status: "unassigned_attempt",
      });
    }
  }

  const counts = { passed: 0, failed: 0, not_attempted: 0, unassigned_attempt: 0 };
  const rows: ModuleRow[] = [];
  for (const row of rowMap.values()) {
    if (row.attempts.length > 0) {
      row.bestScore = row.attempts.reduce(
        (best, a) => Math.max(best, a.score ?? 0),
        0,
      );
      row.latest = row.attempts[0]!;
      row.status = row.attempts.some((a) => a.passed) ? "passed" : "failed";
    } else if (row.assigned) {
      row.status = "not_attempted";
    } else {
      row.status = "unassigned_attempt";
    }
    counts[row.status] += 1;
    rows.push(row);
  }
  rows.sort((a, b) => a.moduleTitle.localeCompare(b.moduleTitle));

  // Machine competency: qualified iff user has passed every module linked
  // to the machine (matches the spirit of user_machine_competencies but
  // ignores the valid_for_days expiry — that's a slice-2c refinement).
  const machineIds = userMachineRows.map((r) => r.machineId);
  const machineLinks = machineIds.length
    ? await ctx.db.run((tx) =>
        tx
          .select({
            machineId: lmsMachineModules.machineId,
            moduleId: lmsMachineModules.moduleId,
            isPublished: lmsModules.isPublished,
          })
          .from(lmsMachineModules)
          .innerJoin(lmsModules, eq(lmsModules.id, lmsMachineModules.moduleId))
          .where(
            and(
              inArray(lmsMachineModules.machineId, machineIds),
              tenantWhere(lmsMachineModules, tid),
            ),
          ),
      )
    : [];
  const passedModuleIds = new Set(
    attempts.filter((a) => a.passed).map((a) => a.moduleId),
  );
  const competencies = userMachineRows.map((m) => {
    const linkedPublished = machineLinks
      .filter((l) => l.machineId === m.machineId && l.isPublished)
      .map((l) => l.moduleId);
    if (linkedPublished.length === 0) {
      return { machineName: m.machineName, status: "no_training_required" as const };
    }
    const passedCount = linkedPublished.filter((id) => passedModuleIds.has(id)).length;
    if (passedCount === linkedPublished.length) {
      return {
        machineName: m.machineName,
        status: "qualified" as const,
        passedCount,
        total: linkedPublished.length,
      };
    }
    if (passedCount === 0) {
      return {
        machineName: m.machineName,
        status: "pending" as const,
        passedCount,
        total: linkedPublished.length,
      };
    }
    return {
      machineName: m.machineName,
      status: "partial" as const,
      passedCount,
      total: linkedPublished.length,
    };
  });

  const recentAttempts = dedupedAttempts.slice(0, 20);
  const certificates = await listEarnedCertificates(userId, tid);

  return (
    <div className="space-y-6">
      <BackLink href="/app/admin/employees">Back to employees</BackLink>

      <Card>
        <CardContent className="flex flex-col gap-6 p-6 sm:flex-row">
          {user.photoFilename ? (
            <img
              src={`/uploads/${encodeURIComponent(user.photoFilename)}`}
              alt={`${user.name} photo`}
              className="h-32 w-32 rounded-md border border-[color:var(--border)] object-cover"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-md border border-dashed border-[color:var(--border)] text-xs text-[color:var(--muted-foreground)]">
              No photo
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{user.name}</h1>
              <RoleBadge role={user.role} />
              {!user.isActiveFlag && <Badge variant="secondary">Disabled</Badge>}
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Field label="Email" value={user.email} />
              <Field label="Phone" value={user.phone || "—"} />
              <Field label="Department" value={user.departmentName ?? "—"} />
              <Field label="Employer" value={user.employerName ?? "—"} />
              <Field label="Position" value={user.positionName ?? "—"} />
              <Field label="Job title" value={user.jobTitle || "—"} />
              <Field
                label="Start date"
                value={user.startDate ? formatDate(user.startDate) : "—"}
              />
              <Field
                label="Termination"
                value={user.terminationDate ? formatDate(user.terminationDate) : "—"}
              />
            </dl>
            <div className="flex gap-2 pt-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/admin/employees/${user.id}/edit`}>Edit</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Training</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={auditMode ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:grid-cols-4"}>
            <Stat label="Passed" value={counts.passed} variant="success" />
            {!auditMode && (
              <Stat label="Failed" value={counts.failed} variant="destructive" />
            )}
            <Stat label="Not attempted" value={counts.not_attempted} variant="outline" />
            {!auditMode && (
              <Stat label="Unassigned attempts" value={counts.unassigned_attempt} variant="secondary" />
            )}
          </div>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Pass mark: {PASS_THRESHOLD}%
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-foreground)]">
              No assignments or attempts yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2">Module</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Best</th>
                    {!auditMode && <th className="px-3 py-2">Attempts</th>}
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">Completed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {rows.map((r) => (
                    <tr key={r.moduleId}>
                      <td className="px-3 py-2 align-middle">{r.moduleTitle}</td>
                      <td className="px-3 py-2 align-middle">
                        <ModuleStatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2 align-middle text-right">
                        {r.bestScore !== null ? `${r.bestScore}%` : "—"}
                      </td>
                      {!auditMode && (
                        <td className="px-3 py-2 align-middle">{r.attempts.length}</td>
                      )}
                      <td className="px-3 py-2 align-middle">
                        {r.dueAt ? formatDate(r.dueAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        {r.completedAt ? formatDate(r.completedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {competencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Machine competencies</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)] p-0">
            {competencies.map((c, i) => (
              <div key={i} className="flex items-center justify-between px-6 py-3">
                <div className="text-sm font-medium">{c.machineName}</div>
                <div className="flex items-center gap-2">
                  <CompetencyBadge status={c.status} />
                  {"total" in c && (
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                      {c.passedCount}/{c.total} modules passed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {recentAttempts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent attempts ({recentAttempts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  <tr>
                    <th className="px-6 py-2">Date</th>
                    <th className="px-3 py-2">Module</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-6 py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {recentAttempts.map((a) => (
                    <tr key={a.id}>
                      <td className="px-6 py-2 align-middle">
                        {a.createdAt ? formatDate(a.createdAt) : "—"}
                      </td>
                      <td className="px-3 py-2 align-middle">{a.moduleTitle ?? a.moduleId}</td>
                      <td className="px-3 py-2 align-middle text-right font-semibold">
                        {a.score}%
                      </td>
                      <td className="px-6 py-2 align-middle">
                        {a.passed ? (
                          <Badge variant="success">Passed</Badge>
                        ) : (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {certificates.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Certificates ({certificates.length})</CardTitle>
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/admin/employees/${userId}/transcript`}>Transcript</Link>
            </Button>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)] p-0">
            {certificates.map((c) => (
              <div
                key={c.moduleId}
                className="flex items-center justify-between gap-4 px-6 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{c.moduleTitle}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    Passed {formatDate(c.passedAt)} · {c.score}%
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app/admin/employees/${userId}/certificate/${c.moduleId}`}>
                    Certificate
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "success" | "destructive" | "outline" | "secondary";
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-3">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xl font-semibold">{value}</span>
        <Badge variant={variant} className="ml-auto">
          {variant === "success" ? "Pass" : variant === "destructive" ? "Fail" : variant === "outline" ? "Pending" : "Other"}
        </Badge>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Badge>Admin</Badge>;
  if (role === "qaqc") return <Badge variant="warning">QA/QC</Badge>;
  return <Badge variant="secondary">Employee</Badge>;
}

function ModuleStatusBadge({ status }: { status: ModuleStatus }) {
  if (status === "passed") return <Badge variant="success">Passed</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "not_attempted") return <Badge variant="outline">Not attempted</Badge>;
  return <Badge variant="secondary">Unassigned attempt</Badge>;
}

function CompetencyBadge({
  status,
}: {
  status: "qualified" | "partial" | "pending" | "no_training_required";
}) {
  if (status === "qualified") return <Badge variant="success">Qualified</Badge>;
  if (status === "partial") return <Badge variant="warning">Partial</Badge>;
  if (status === "pending") return <Badge variant="destructive">Pending</Badge>;
  return <Badge variant="outline">No training required</Badge>;
}

