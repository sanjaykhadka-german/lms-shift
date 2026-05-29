import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { lmsDepartments, lmsPositions, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { PageHeader } from "~/components/page-header";
import { DeleteRowForm } from "../_components/DeleteRowForm";
import { CreatePositionForm } from "./_form";
import { deletePositionAction } from "./actions";

export const metadata = { title: "Positions" };

export default async function PositionsPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const [positions, departments] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsPositions.id,
          name: lmsPositions.name,
          parentId: lmsPositions.parentId,
          departmentId: lmsPositions.departmentId,
          sortOrder: lmsPositions.sortOrder,
          departmentName: lmsDepartments.name,
          headcount: sql<number>`(
            select count(*)::int from ${lmsUsers}
              where ${lmsUsers.positionId} = ${lmsPositions.id}
                and ${lmsUsers.isActiveFlag} = true
                and ${lmsUsers.traceyTenantId} = ${tid}
          )`,
        })
        .from(lmsPositions)
        .leftJoin(
          lmsDepartments,
          and(eq(lmsDepartments.id, lmsPositions.departmentId), tenantWhere(lmsDepartments, tid)),
        )
        .where(tenantWhere(lmsPositions, tid))
        .orderBy(asc(lmsPositions.sortOrder), asc(lmsPositions.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
  ]);

  const positionLookup = new Map(positions.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Positions"
        description="The roles that make up your org chart. Hierarchy is between positions, not people — when staff change, the chart stays."
        actions={
          <Button asChild variant="outline" tooltip="View the organisation chart">
            <Link href="/app/admin/positions/chart">View org chart →</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add a position</CardTitle>
          <CardDescription>Optional parent + department.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreatePositionForm
            positions={positions.map((p) => ({ id: p.id, name: p.name }))}
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All positions ({positions.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-[color:var(--border)] p-0">
          {positions.length === 0 ? (
            <p className="px-6 py-4 text-sm text-[color:var(--muted-foreground)]">
              No positions yet.
            </p>
          ) : (
            positions.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-[color:var(--muted-foreground)]">
                    {p.parentId ? `Reports to ${positionLookup.get(p.parentId) ?? "—"}` : "Top-level"}
                    {" · "}
                    {p.departmentName ?? "No department"}
                    {" · "}
                    {p.headcount} staff
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/admin/positions/${p.id}/edit`}>Edit</Link>
                  </Button>
                  <DeleteRowForm
                    action={deletePositionAction}
                    id={p.id}
                    confirmMessage={`Delete '${p.name}'? Children re-parent; staff become unassigned.`}
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

