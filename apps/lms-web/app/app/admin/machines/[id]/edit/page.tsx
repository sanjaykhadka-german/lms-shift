import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  lmsDepartments,
  lmsMachineModules,
  lmsMachines,
  lmsModules,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateMachineAction } from "../../actions";

export const metadata = { title: "Edit machine" };

export default async function EditMachinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const machineId = parseInt(id, 10);
  if (!Number.isFinite(machineId)) notFound();
  const { error } = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [[machine], departments, modules, links] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsMachines)
        .where(and(eq(lmsMachines.id, machineId), tenantWhere(lmsMachines, tid)))
        .limit(1),
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
        .select({ id: lmsModules.id, title: lmsModules.title })
        .from(lmsModules)
        .where(and(eq(lmsModules.isPublished, true), tenantWhere(lmsModules, tid)))
        .orderBy(asc(lmsModules.title)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ moduleId: lmsMachineModules.moduleId })
        .from(lmsMachineModules)
        .where(
          and(eq(lmsMachineModules.machineId, machineId), tenantWhere(lmsMachineModules, tid)),
        ),
    ),
  ]);
  if (!machine) notFound();
  const linkedModuleIds = new Set(links.map((l) => l.moduleId));

  return (
    <div className="space-y-4">
      <BackLink href="/app/admin/machines">Back to machines</BackLink>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Edit machine</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateMachineAction} className="space-y-4">
            <input type="hidden" name="id" value={machine.id} />
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={machine.name} required />
              {error === "duplicate" && (
                <p className="text-xs text-[color:var(--destructive)]">
                  Another machine already has that name.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="department_id">Department</Label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={machine.departmentId ?? ""}
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— None —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Linked modules</Label>
              {modules.length === 0 ? (
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  No published modules to link yet.
                </p>
              ) : (
                <div className="grid gap-1 max-h-72 overflow-y-auto rounded-md border border-[color:var(--border)] p-3">
                  {modules.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="module_ids"
                        value={m.id}
                        defaultChecked={linkedModuleIds.has(m.id)}
                      />
                      {m.title}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-[color:var(--muted-foreground)]">
                Staff become qualified on this machine once they pass every
                linked module.
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              <Button asChild variant="outline">
                <Link href="/app/admin/machines">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
