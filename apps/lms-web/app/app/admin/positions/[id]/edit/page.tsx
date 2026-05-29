import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, eq, ne } from "drizzle-orm";
import { lmsDepartments, lmsPositions } from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updatePositionAction } from "../../actions";

export const metadata = { title: "Edit position" };

export default async function EditPositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const positionId = parseInt(id, 10);
  if (!Number.isFinite(positionId)) notFound();
  const { error } = await searchParams;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [[position], otherPositions, departments] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsPositions)
        .where(and(eq(lmsPositions.id, positionId), tenantWhere(lmsPositions, tid)))
        .limit(1),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsPositions.id, name: lmsPositions.name })
        .from(lmsPositions)
        .where(and(ne(lmsPositions.id, positionId), tenantWhere(lmsPositions, tid)))
        .orderBy(asc(lmsPositions.name)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid))
        .orderBy(asc(lmsDepartments.name)),
    ),
  ]);
  if (!position) notFound();

  return (
    <div className="space-y-4">
      <BackLink href="/app/admin/positions">Back to positions</BackLink>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Edit position</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updatePositionAction} className="space-y-4">
            <input type="hidden" name="id" value={position.id} />
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={position.name} required />
              {error === "name" && (
                <p className="text-xs text-[color:var(--destructive)]">
                  Name is required.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent_id">Reports to</Label>
              <select
                id="parent_id"
                name="parent_id"
                defaultValue={position.parentId ?? ""}
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              >
                <option value="">— Top-level —</option>
                {otherPositions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[color:var(--muted-foreground)]">
                Self-as-parent and direct cycles are blocked automatically.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="department_id">Department</Label>
              <select
                id="department_id"
                name="department_id"
                defaultValue={position.departmentId ?? ""}
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
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
              <Button asChild variant="outline">
                <Link href="/app/admin/positions">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
