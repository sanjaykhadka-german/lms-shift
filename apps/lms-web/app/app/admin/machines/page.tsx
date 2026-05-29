import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { lmsDepartments, lmsMachineModules, lmsMachines } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PageHeader } from "~/components/page-header";
import { NameCrudForm } from "../_components/NameCrudForm";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { createMachineAction, deleteMachineAction } from "./actions";

export const metadata = { title: "Machines" };

export default async function MachinesPage() {
  const ctx = await requireAdmin();
  const machines = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsMachines.id,
        name: lmsMachines.name,
        departmentId: lmsMachines.departmentId,
        departmentName: lmsDepartments.name,
        moduleCount: sql<number>`(
          select count(*)::int from ${lmsMachineModules}
            where ${lmsMachineModules.machineId} = ${lmsMachines.id}
        )`,
      })
      .from(lmsMachines)
      .leftJoin(lmsDepartments, eq(lmsDepartments.id, lmsMachines.departmentId))
      .where(tenantWhere(lmsMachines, ctx.traceyTenantId))
      .orderBy(asc(lmsMachines.name)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Machines"
        description="Equipment that requires training to operate. Link a machine to one or more modules — staff become qualified on it once they pass every linked module."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a machine</CardTitle>
          <CardDescription>
            You can set its department + linked modules on the edit page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NameCrudForm
            action={createMachineAction}
            label="Machine name"
            placeholder="e.g. Slicer line A"
            submitLabel="Add"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All machines ({machines.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {machines.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No machines yet.
            </p>
          ) : (
            machines.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {m.departmentName ?? "No department"} · {m.moduleCount} module{m.moduleCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm" tooltip="Edit this machine's details">
                    <Link href={`/app/admin/machines/${m.id}/edit`}>Edit</Link>
                  </Button>
                  <DeleteRowForm
                    action={deleteMachineAction}
                    id={m.id}
                    tooltip="Delete this machine"
                    confirmMessage={`Delete machine '${m.name}'?`}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
