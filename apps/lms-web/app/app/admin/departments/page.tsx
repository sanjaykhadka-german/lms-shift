import Link from "next/link";
import { asc } from "drizzle-orm";
import { lmsDepartments } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PageHeader } from "~/components/page-header";
import { NameCrudForm } from "../_components/NameCrudForm";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { createDepartmentAction, deleteDepartmentAction } from "./actions";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const ctx = await requireAdmin();
  const rows = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsDepartments)
      .where(tenantWhere(lmsDepartments, ctx.traceyTenantId))
      .orderBy(asc(lmsDepartments.name)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="The teams staff belong to. Pick which modules each department auto-assigns to new staff via the policies grid."
        actions={
          <Button asChild variant="outline">
            <Link href="/app/admin/departments/policies">Module policies →</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a department</CardTitle>
          <CardDescription>Names must be unique.</CardDescription>
        </CardHeader>
        <CardContent>
          <NameCrudForm
            action={createDepartmentAction}
            label="Department name"
            placeholder="e.g. Production"
            submitLabel="Add"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All departments ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No departments yet.
            </p>
          ) : (
            rows.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-6 py-3">
                <span className="text-sm font-medium">{d.name}</span>
                <DeleteRowForm
                  action={deleteDepartmentAction}
                  id={d.id}
                  confirmMessage={`Delete '${d.name}'? Staff in this department will be unassigned.`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
