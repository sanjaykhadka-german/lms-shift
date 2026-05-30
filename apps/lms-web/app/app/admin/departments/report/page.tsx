import { requireAdmin } from "~/lib/auth/admin";
import { departmentCompletionReport } from "~/lib/lms/queries/department-report";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export const metadata = { title: "Department completion report" };

export default async function DepartmentReportPage() {
  const ctx = await requireAdmin();
  const rows = await departmentCompletionReport(ctx.traceyTenantId);

  const totals = rows.reduce(
    (t, r) => ({
      employees: t.employees + r.employees,
      assigned: t.assigned + r.assigned,
      completed: t.completed + r.completed,
      overdue: t.overdue + r.overdue,
    }),
    { employees: 0, assigned: 0, completed: 0, overdue: 0 },
  );
  const totalPct =
    totals.assigned === 0
      ? 0
      : Math.round((totals.completed * 1000) / totals.assigned) / 10;

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 px-4 py-10">
      <PageHeader
        title="Department completion"
        description="Training-assignment completion by department, across active employees."
        badge={
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Report
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <a href="/app/admin/departments/report/csv">Export CSV</a>
          </Button>
        }
      />

      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
            <tr className="border-b border-[color:var(--border)]">
              <th className="px-6 py-3">Department</th>
              <th className="px-3 py-3 text-right">Employees</th>
              <th className="px-3 py-3 text-right">Assigned</th>
              <th className="px-3 py-3 text-right">Completed</th>
              <th className="px-3 py-3 text-right">Overdue</th>
              <th className="px-6 py-3 text-right">Completion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {rows.map((r) => (
              <tr key={r.departmentId ?? "none"}>
                <td className="px-6 py-3 font-medium">{r.departmentName}</td>
                <td className="px-3 py-3 text-right">{r.employees}</td>
                <td className="px-3 py-3 text-right">{r.assigned}</td>
                <td className="px-3 py-3 text-right">{r.completed}</td>
                <td className="px-3 py-3 text-right">
                  {r.overdue > 0 ? (
                    <Badge variant="destructive">{r.overdue}</Badge>
                  ) : (
                    0
                  )}
                </td>
                <td className="px-6 py-3 text-right font-semibold">{r.completionPct}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-[color:var(--muted-foreground)]">
                  No departments or assignments yet.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-[color:var(--border)] font-semibold">
                <td className="px-6 py-3">All departments</td>
                <td className="px-3 py-3 text-right">{totals.employees}</td>
                <td className="px-3 py-3 text-right">{totals.assigned}</td>
                <td className="px-3 py-3 text-right">{totals.completed}</td>
                <td className="px-3 py-3 text-right">{totals.overdue}</td>
                <td className="px-6 py-3 text-right">{totalPct}%</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
