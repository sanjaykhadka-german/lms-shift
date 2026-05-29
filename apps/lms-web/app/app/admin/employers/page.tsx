import { asc } from "drizzle-orm";
import { lmsEmployers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NameCrudForm } from "../_components/NameCrudForm";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { createEmployerAction, deleteEmployerAction } from "./actions";

export const metadata = { title: "Employers" };

export default async function EmployersPage() {
  const ctx = await requireAdmin();
  const rows = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsEmployers)
      .where(tenantWhere(lmsEmployers, ctx.traceyTenantId))
      .orderBy(asc(lmsEmployers.name)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Employers</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Legal entities that pay your staff. Useful when you have shared
          training across multiple companies or labour-hire agencies.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add an employer</CardTitle>
          <CardDescription>Names must be unique.</CardDescription>
        </CardHeader>
        <CardContent>
          <NameCrudForm
            action={createEmployerAction}
            label="Employer name"
            placeholder="e.g. German Butchery Pty Ltd"
            submitLabel="Add"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All employers ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {rows.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No employers yet.
            </p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-6 py-3">
                <span className="text-sm font-medium">{e.name}</span>
                <DeleteRowForm
                  action={deleteEmployerAction}
                  id={e.id}
                  confirmMessage={`Delete '${e.name}'? Staff with this employer will be reassigned to none.`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
