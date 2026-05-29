import Link from "next/link";
import { Upload } from "lucide-react";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  lmsDepartmentModulePolicies,
  lmsDepartments,
  lmsEmployers,
  lmsModules,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { employeeStatus } from "~/lib/lms/employee-status";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { HelpPopover } from "~/components/ui/help-popover";
import { PageHeader } from "~/components/page-header";
import { NewEmployeeForm } from "./_new-form";
import { RowActions } from "./_row-actions";
import { StatusPicker } from "./_status-picker";

export const metadata = { title: "Employees" };

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [employees, departments, employers, positions, publishedModules, policyRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          name: lmsUsers.name,
          email: lmsUsers.email,
          role: lmsUsers.role,
          isActiveFlag: lmsUsers.isActiveFlag,
          terminationDate: lmsUsers.terminationDate,
          departmentName: lmsDepartments.name,
          employerName: lmsEmployers.name,
          positionName: lmsPositions.name,
        })
        .from(lmsUsers)
        .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsUsers.departmentId))
        .leftJoin(lmsEmployers, eq(lmsEmployers.id, lmsUsers.employerId))
        .leftJoin(lmsPositions, eq(lmsPositions.id, lmsUsers.positionId))
        .where(eq(lmsUsers.traceyTenantId, tid))
        .orderBy(desc(lmsUsers.role), asc(lmsUsers.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsEmployers)
        .where(tenantWhere(lmsEmployers, tid))
        .orderBy(asc(lmsEmployers.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsPositions.id, name: lmsPositions.name })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid))
        .orderBy(asc(lmsPositions.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(and(eq(lmsModules.isPublished, true), tenantWhere(lmsModules, tid)))
        .orderBy(asc(lmsModules.title)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({
          departmentId: lmsDepartmentModulePolicies.departmentId,
          moduleId: lmsDepartmentModulePolicies.moduleId,
        })
        .from(lmsDepartmentModulePolicies)
        .where(tenantWhere(lmsDepartmentModulePolicies, tid)),
    ),
  ]);

  const policiesByDept: Record<number, number[]> = {};
  for (const p of policyRows) {
    (policiesByDept[p.departmentId] ??= []).push(p.moduleId);
  }

  const statusCounts = { active: 0, disabled: 0, terminated: 0 };
  for (const e of employees) statusCounts[employeeStatus(e)]++;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description={`${employees.length} total · ${statusCounts.active} active · ${statusCounts.disabled} disabled · ${statusCounts.terminated} terminated`}
        actions={
          <Button asChild variant="outline">
            <Link href="/app/admin/employees/bulk">
              <Upload className="mr-1 h-4 w-4" /> Bulk upload
            </Link>
          </Button>
        }
      />

      {error && <ErrorBanner code={error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add an employee</CardTitle>
          <CardDescription>
            They&rsquo;ll be emailed a temporary password to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewEmployeeForm
            departments={departments}
            employers={employers}
            positions={positions}
            publishedModules={publishedModules}
            policiesByDept={policiesByDept}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All employees ({employees.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Name</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      Status
                      <HelpPopover label="About employee status">
                        <div className="space-y-2 text-xs">
                          <p>
                            <span className="font-semibold">Active</span> —
                            currently employed and able to sign in.
                          </p>
                          <p>
                            <span className="font-semibold">Disabled</span> —
                            temporarily blocked from signing in. Records are
                            kept and the employee can be re-activated at any
                            time. Use for paused contracts, leave without pay,
                            or temporary suspensions.
                          </p>
                          <p>
                            <span className="font-semibold">Terminated</span> —
                            employment has ended. Sets a termination date
                            (defaulting to today) and blocks sign-in. Training
                            history is preserved for audit. Use the Edit page
                            to set a future termination date.
                          </p>
                        </div>
                      </HelpPopover>
                    </span>
                  </th>
                  <th className="px-6 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {employees.map((e) => {
                  const status = employeeStatus(e);
                  return (
                    <tr key={e.id}>
                      <td className="px-6 py-3 align-middle">
                        <div className="font-medium">
                          <Link href={`/app/admin/employees/${e.id}`} className="hover:underline">
                            {e.name}
                          </Link>
                        </div>
                        <div className="text-xs text-[color:var(--muted-foreground)]">{e.email}</div>
                      </td>
                      <td className="px-3 py-3 align-middle">{e.departmentName ?? "—"}</td>
                      <td className="px-3 py-3 align-middle">{e.positionName ?? "—"}</td>
                      <td className="px-3 py-3 align-middle">
                        <RoleBadge role={e.role} />
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <StatusPicker
                          id={e.id}
                          status={status}
                          terminationDate={e.terminationDate}
                        />
                      </td>
                      <td className="px-6 py-3 align-middle text-right">
                        <RowActions id={e.id} currentRole={e.role} />
                      </td>
                    </tr>
                  );
                })}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No employees yet. Add one above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <Badge>Admin</Badge>;
  if (role === "qaqc") return <Badge variant="warning">QA/QC</Badge>;
  return <Badge variant="secondary">Employee</Badge>;
}

function ErrorBanner({ code }: { code: string }) {
  const messages: Record<string, string> = {
    self_toggle: "You can't disable your own account.",
    self_role: "You can't change your own role.",
    forbidden: "Only owners can promote or modify admin accounts.",
  };
  return (
    <div className="rounded-md border border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 px-4 py-2 text-sm text-[color:var(--destructive)]">
      {messages[code] ?? "Action blocked."}
    </div>
  );
}

