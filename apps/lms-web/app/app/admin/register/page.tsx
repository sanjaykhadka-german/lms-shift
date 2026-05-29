import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import {
  lmsDepartments,
  lmsEmployers,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export const metadata = { title: "Staff register" };

export default async function StaffRegisterPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const rows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsUsers.id,
        name: lmsUsers.name,
        email: lmsUsers.email,
        phone: lmsUsers.phone,
        role: lmsUsers.role,
        isActiveFlag: lmsUsers.isActiveFlag,
        jobTitle: lmsUsers.jobTitle,
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
      .where(eq(lmsUsers.traceyTenantId, tid))
      .orderBy(asc(lmsUsers.name)),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff register</h1>
          <p className="text-sm text-[color:var(--muted-foreground)]">
            Quick-glance view of every staff member with name, email, phone, dept,
            employer, position, and start/end dates. Export as CSV for HR systems.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/admin/register/csv">Download CSV</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Staff ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-6 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Department</th>
                  <th className="px-3 py-2">Employer</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-3 py-2">End</th>
                  <th className="px-6 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-6 text-center text-[color:var(--muted-foreground)]">
                      No staff yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-6 py-2 align-middle">
                        <Link href={`/app/admin/employees/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-middle">{r.email}</td>
                      <td className="px-3 py-2 align-middle">{r.phone ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">{r.departmentName ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">{r.employerName ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">{r.positionName ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">{r.startDate ?? "—"}</td>
                      <td className="px-3 py-2 align-middle">{r.terminationDate ?? "—"}</td>
                      <td className="px-6 py-2 align-middle">
                        {r.isActiveFlag ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Disabled</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
