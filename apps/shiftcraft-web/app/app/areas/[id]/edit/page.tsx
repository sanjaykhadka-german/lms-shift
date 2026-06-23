import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { forTenant, scAreas, scLocations, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { listActiveSkills, listAreaSkillIds } from "~/lib/skills";
import { Button } from "~/components/ui/button";
import { AreaForm } from "../../_form";
import { AreaSkillsForm } from "../../_area-skills-form";
import { deleteAreaAction } from "../../actions";

export const metadata = { title: "Edit area · ShiftCraft" };

export default async function EditAreaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/areas");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scAreas.id,
        locationId: scAreas.locationId,
        locationName: scLocations.name,
        name: scAreas.name,
        color: scAreas.color,
        shifts: sql<number>`(
          SELECT count(*)::int FROM ${scShifts}
          WHERE ${scShifts.locationId} = ${scAreas.locationId}
            AND ${scShifts.role} = ${scAreas.name}
        )`,
      })
      .from(scAreas)
      .leftJoin(scLocations, eq(scLocations.id, scAreas.locationId))
      .where(and(eq(scAreas.id, id), eq(scAreas.traceyTenantId, tenantId)))
      .limit(1),
  );
  if (!row) notFound();

  const [skills, areaSkillIds] = await Promise.all([
    listActiveSkills(tenantId),
    listAreaSkillIds(tenantId, row.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Edit {row.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {row.locationName ?? "No location"} ·{" "}
            {row.shifts} {row.shifts === 1 ? "shift" : "shifts"}
          </p>
        </div>
        <Link
          href="/app/areas"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <AreaForm
          mode="edit"
          areaId={row.id}
          locations={[]}
          defaultValues={{
            locationId: row.locationId,
            locationName: row.locationName ?? undefined,
            name: row.name,
            color: row.color,
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-ink">
          Required skills / training
        </h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Mark the skills someone needs to work in this area. Rostering anyone
          who's missing one shows a soft warning on the schedule — it never
          blocks the assignment.
        </p>
        <AreaSkillsForm
          areaId={row.id}
          skills={skills}
          selectedIds={areaSkillIds}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete area
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.shifts > 0 ? (
            <>
              {row.shifts} {row.shifts === 1 ? "shift" : "shifts"} use this
              area. Deleting only removes it from the pick-list — those shifts
              keep their role and stay on the schedule.
            </>
          ) : (
            "No shifts use this area, so deleting is safe."
          )}
        </p>
        <form action={deleteAreaAction} className="mt-3">
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="outline"
            className="border-[color:var(--destructive)]/40 text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
