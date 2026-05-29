import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  lmsAssignments,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { bulkAssignModuleAction, unassignModuleAction } from "./actions";
import { AssignedList, StaffPicker } from "./_filtered-lists";

export const metadata = { title: "Assign module" };

export default async function AssignModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; created?: string; requested?: string; info?: string }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();
  const sp = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [module] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1),
  );
  if (!module) notFound();

  const [employees, currentRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          name: lmsUsers.name,
          email: lmsUsers.email,
          isActiveFlag: lmsUsers.isActiveFlag,
          departmentName: lmsDepartments.name,
        })
        .from(lmsUsers)
        .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
        .where(eq(lmsUsers.traceyTenantId, tid))
        .orderBy(asc(lmsUsers.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsAssignments.id,
          userId: lmsAssignments.userId,
          userName: lmsUsers.name,
          userEmail: lmsUsers.email,
          assignedAt: lmsAssignments.assignedAt,
          dueAt: lmsAssignments.dueAt,
          completedAt: lmsAssignments.completedAt,
          departmentName: lmsDepartments.name,
        })
        .from(lmsAssignments)
        .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
        .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
        .where(
          and(
            eq(lmsAssignments.moduleId, moduleId),
            tenantWhere(lmsAssignments, tid),
          ),
        )
        .orderBy(asc(lmsUsers.name)),
    ),
  ]);
  const alreadyAssignedIds = currentRows.map((r) => r.userId);
  const deptOptions = Array.from(
    new Set(
      [
        ...employees.map((e) => e.departmentName),
        ...currentRows.map((r) => r.departmentName),
      ].filter((d): d is string => Boolean(d)),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <Link
        href={`/app/admin/modules/${moduleId}`}
        className="text-sm text-[color:var(--muted-foreground)] underline"
      >
        ← Back to edit
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assign “{module.title}”</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Pick staff to assign this module to. Existing assignees are
          listed at the bottom — tick more from the table to extend the list.
        </p>
      </div>

      {sp.ok === "1" && (
        <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
          Created {sp.created} new assignment{sp.created === "1" ? "" : "s"}{" "}
          (requested {sp.requested}; duplicates skipped silently).
        </div>
      )}
      {sp.info === "nochosen" && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] px-4 py-2 text-sm">
          No staff selected.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pick staff to assign</CardTitle>
          <CardDescription>
            Already-assigned staff are pre-checked and disabled — re-checking them does nothing
            (the unique (user, module) constraint silently skips duplicates).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffPicker
            moduleId={module.id}
            employees={employees}
            alreadyAssignedIds={alreadyAssignedIds}
            departments={deptOptions}
            bulkAssignAction={bulkAssignModuleAction}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Already assigned ({currentRows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AssignedList
            moduleId={module.id}
            rows={currentRows}
            departments={deptOptions}
            unassignAction={unassignModuleAction}
            tenantTimezone={ctx.tenantTimezone}
          />
        </CardContent>
      </Card>
    </div>
  );
}
