import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { and, asc, eq } from "drizzle-orm";
import {
  lmsModules,
  lmsPositionModulePolicies,
  lmsPositions,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { savePositionPoliciesAction } from "./actions";

export const metadata = { title: "Position policies" };

export default async function PositionPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; added?: string; removed?: string; assigned?: string; info?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [positions, modules, policies] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsPositions.id, name: lmsPositions.name })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid))
        .orderBy(asc(lmsPositions.sortOrder), asc(lmsPositions.name)),
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
          positionId: lmsPositionModulePolicies.positionId,
          moduleId: lmsPositionModulePolicies.moduleId,
        })
        .from(lmsPositionModulePolicies)
        .where(tenantWhere(lmsPositionModulePolicies, tid)),
    ),
  ]);
  const policySet = new Set(policies.map((p) => `${p.positionId}:${p.moduleId}`));

  return (
    <div className="space-y-6">
      <BackLink href="/app/admin/positions">Back to positions</BackLink>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Position policies</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Pick which modules each position auto-assigns to new staff (and to
          existing staff when they move into the position). These apply on top of
          any department policies.
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

      {positions.length === 0 || modules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Nothing to configure yet</CardTitle>
            <CardDescription>
              {positions.length === 0 && "Add at least one position first. "}
              {modules.length === 0 && "Publish at least one module before linking policies."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={savePositionPoliciesAction}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Policy grid</CardTitle>
              <CardDescription>
                Each checkbox links a position to a module. Saved changes are
                applied to existing staff via the next position change or the
                next time an admin runs auto-assign on them; new hires get them
                automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                      <th className="sticky left-0 z-10 bg-[color:var(--card)] px-6 py-2">Module</th>
                      {positions.map((p) => (
                        <th key={p.id} className="px-3 py-2 text-center">
                          {p.name}
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
                        {positions.map((p) => {
                          const key = `${p.id}:${m.id}`;
                          return (
                            <td key={p.id} className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                name={`policy_${p.id}_${m.id}`}
                                value="1"
                                defaultChecked={policySet.has(key)}
                                aria-label={`${p.name} → ${m.title}`}
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
              <Link href="/app/admin/positions">Cancel</Link>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
