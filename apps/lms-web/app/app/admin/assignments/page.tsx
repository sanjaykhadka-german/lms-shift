import { and, asc, eq } from "drizzle-orm";
import {
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { formatDateTime } from "~/lib/format/datetime";
import {
  listAdminAssignments,
  listRecentAdminAssignments,
} from "~/lib/lms/queries/assignments";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { HelpPopover } from "~/components/ui/help-popover";
import { PageHeader } from "~/components/page-header";
import { deleteAssignmentAction } from "./actions";
import { bulkAssignModuleAction } from "../modules/[id]/assign/actions";
import { AssignmentsTable, BulkAssign } from "./_filtered";

export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [rows, recent, employees, modulesList] = await Promise.all([
    listAdminAssignments(ctx),
    listRecentAdminAssignments(ctx, 5),
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          name: lmsUsers.name,
          email: lmsUsers.email,
          isActiveFlag: lmsUsers.isActiveFlag,
          terminationDate: lmsUsers.terminationDate,
          departmentName: lmsDepartments.name,
        })
        .from(lmsUsers)
        .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
        .where(eq(lmsUsers.traceyTenantId, tid))
        .orderBy(asc(lmsUsers.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(and(eq(lmsModules.isPublished, true), tenantWhere(lmsModules, tid)))
        .orderBy(asc(lmsModules.title)),
    ),
  ]);

  const deptOptions = Array.from(
    new Set(
      [
        ...rows.map((r) => r.departmentName),
        ...employees.map((e) => e.departmentName),
      ].filter((d): d is string => Boolean(d)),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const now = Date.now();
  const soonMs = 14 * 24 * 60 * 60 * 1000;
  let total = 0;
  let completed = 0;
  let overdue = 0;
  let dueSoon = 0;
  for (const r of rows) {
    total += 1;
    if (r.completedAt) completed += 1;
    else if (r.dueAt) {
      const t = r.dueAt.getTime();
      if (t < now) overdue += 1;
      else if (t < now + soonMs) dueSoon += 1;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <>
            Assignments
            <HelpPopover label="About assignments">
              An <strong>assignment</strong> means a specific employee is
              expected to complete a specific module. Assign in bulk from the
              card below, or auto-assign via department policy. Statuses:
              <strong> Open</strong> = not yet attempted,
              <strong> Due ≤14d</strong> = due within two weeks,
              <strong> Overdue</strong> = past the due date,
              <strong> Completed</strong> = passed the quiz.
            </HelpPopover>
          </>
        }
        description="Pick a module and the staff to enrol in one go below. Use the table to spot-check status and unassign individual rows."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bulk assign</CardTitle>
          <CardDescription>
            Already-assigned (user, module) pairs are silently skipped. Each
            new recipient gets an in-app notification and a summary email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BulkAssign
            employees={employees}
            modules={modulesList}
            departments={deptOptions}
            bulkAssignAction={bulkAssignModuleAction}
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="Total" value={total} />
        <SummaryStat label="Completed" value={completed} variant="success" />
        <SummaryStat label="Overdue" value={overdue} variant="destructive" />
        <SummaryStat label="Due ≤14d" value={dueSoon} variant="warning" />
      </div>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recently assigned</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-[color:var(--border)] p-0">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-6 py-2 text-sm">
                <span>
                  <strong>{r.userName}</strong> → {r.moduleTitle}
                </span>
                <span className="text-xs text-[color:var(--muted-foreground)]">
                  {r.assignedAt ? formatDateTime(r.assignedAt, ctx.tenantTimezone) : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All assignments ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AssignmentsTable
            rows={rows}
            departments={deptOptions}
            deleteAction={deleteAssignmentAction}
            tenantTimezone={ctx.tenantTimezone}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "success" | "destructive" | "warning";
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-4">
      <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-semibold">{value}</span>
        {variant && <Badge variant={variant}>{label}</Badge>}
      </div>
    </div>
  );
}
