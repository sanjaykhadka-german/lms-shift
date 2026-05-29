import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { and, asc, eq, sql } from "drizzle-orm";
import { lmsDepartments, lmsPositions, lmsUsers } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export const metadata = { title: "Org chart" };

interface ChartNode {
  id: number;
  name: string;
  departmentName: string | null;
  headcount: number;
  children: ChartNode[];
}

export default async function OrgChartPage() {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const rows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsPositions.id,
        name: lmsPositions.name,
        parentId: lmsPositions.parentId,
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
  );

  // Build tree. Anything whose parent_id is unknown (e.g. a deleted parent)
  // surfaces as a root.
  const byId = new Map<number, ChartNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      departmentName: r.departmentName ?? null,
      headcount: r.headcount,
      children: [],
    });
  }
  const roots: ChartNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parentId !== null && byId.has(r.parentId)) {
      byId.get(r.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Unassigned active staff (no position).
  const unassignedRows = await ctx.db.run((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(lmsUsers)
      .where(
        sql`${lmsUsers.positionId} is null
              and ${lmsUsers.isActiveFlag} = true
              and ${lmsUsers.traceyTenantId} = ${tid}`,
      ),
  );
  const unassignedCount = unassignedRows[0]?.count ?? 0;

  return (
    <div className="space-y-6">
      <BackLink href="/app/admin/positions">Back to positions</BackLink>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Org chart</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Hierarchy of positions, with active headcount per role. Click a
          position to edit its name, parent, or department.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {rows.length} position{rows.length === 1 ? "" : "s"}
            {unassignedCount > 0 && (
              <span className="ml-2 text-sm font-normal text-[color:var(--muted-foreground)]">
                · {unassignedCount} unassigned
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {roots.length === 0 ? (
            <p className="text-sm text-[color:var(--muted-foreground)]">
              No positions yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {roots.map((root) => (
                <ChartRow key={root.id} node={root} depth={0} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChartRow({ node, depth }: { node: ChartNode; depth: number }) {
  return (
    <li>
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2"
        style={{ marginLeft: depth * 24 }}
      >
        <div className="min-w-0">
          <Link
            href={`/app/admin/positions/${node.id}/edit`}
            className="text-sm font-medium hover:underline"
          >
            {node.name}
          </Link>
          <div className="text-xs text-[color:var(--muted-foreground)]">
            {node.departmentName ?? "No department"} · {node.headcount} active
          </div>
        </div>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {node.children.map((c) => (
            <ChartRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
