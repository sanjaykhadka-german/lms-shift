import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { and, asc, eq } from "drizzle-orm";
import {
  lmsDepartmentModulePolicies,
  lmsDepartments,
  lmsModules,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { saveDepartmentPoliciesAction } from "./actions";

export const metadata = { title: "Department policies" };

export default async function DepartmentPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; added?: string; removed?: string; assigned?: string; info?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [departments, modules, policies] = await Promise.all([
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
        .select({
          departmentId: lmsDepartmentModulePolicies.departmentId,
          moduleId: lmsDepartmentModulePolicies.moduleId,
        })
        .from(lmsDepartmentModulePolicies)
        .where(tenantWhere(lmsDepartmentModulePolicies, tid)),
    ),
  ]);
  const policySet = new Set(policies.map((p) => `${p.departmentId}:${p.moduleId}`));

  return (
    <div className="space-y-6">
      <BackLink href="/app/admin/departments">Back to departments</BackLink>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Department policies</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Pick which modules each department auto-assigns to new staff (and to
          existing staff when they move into the department).
        </p>
      </div>

      {sp.ok === "1" && (() => {
        const assigned = parseInt(sp.assigned ?? "0", 10) || 0;
        return (
          <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-4 py-2 text-sm dark:bg-emerald-900/10">
            Saved — {sp.added ?? 0} added, {sp.removed ?? 0} removed.
            {assigned > 0 && ` ${assigned} new assignment${assigned === 1 ? "" : "s"} created for existing staff.`}
          </div>
        );
      })()}
      {sp.info === "nochange" && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] px-4 py-2 text-sm">
          No changes.
        </div>
      )}

      {departments.length === 0 || modules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Nothing to configure yet</CardTitle>
            <CardDescription>
              {departments.length === 0 && "Add at least one department first. "}
              {modules.length === 0 && "Publish at least one module before linking policies."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={saveDepartmentPoliciesAction}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Policy grid</CardTitle>
              <CardDescription>
                Each checkbox links a department to a module. Saved changes are
                applied to existing staff via the next department change or the
                next time an admin runs auto-assign on them; new hires get
                them automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      <th className="sticky left-0 z-10 bg-[color:var(--card)] px-6 py-2">Module</th>
                      {departments.map((d) => (
                        <th key={d.id} className="px-3 py-2 text-center">
                          {d.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border)]">
                    {modules.map((m) => (
                      <tr key={m.id}>
                        <td className="sticky left-0 z-10 bg-[color:var(--card)] px-6 py-2 font-medium">
                          {m.title}
                        </td>
                        {departments.map((d) => {
                          const key = `${d.id}:${m.id}`;
                          return (
                            <td key={d.id} className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                name={`policy_${d.id}_${m.id}`}
                                value="1"
                                defaultChecked={policySet.has(key)}
                                aria-label={`${d.name} → ${m.title}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
          <div className="mt-4 flex gap-2">
            <Button type="submit">Save policies</Button>
            <Button asChild variant="outline">
              <Link href="/app/admin/departments">Cancel</Link>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
