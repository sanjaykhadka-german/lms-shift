import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations, scShiftTemplates } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { listActiveSkills } from "~/lib/skills";
import { ShiftForm } from "../_form";

export const metadata = { title: "New shift · ShiftCraft" };

export default async function NewShiftPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const tenantId = membership.tenant.id;
  const [locations, templates, skills] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .orderBy(asc(scLocations.name)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scShiftTemplates.id,
          name: scShiftTemplates.name,
          locationId: scShiftTemplates.locationId,
          role: scShiftTemplates.role,
          startHour: scShiftTemplates.startHour,
          startMinute: scShiftTemplates.startMinute,
          endHour: scShiftTemplates.endHour,
          endMinute: scShiftTemplates.endMinute,
          defaultNotes: scShiftTemplates.defaultNotes,
        })
        .from(scShiftTemplates)
        .where(eq(scShiftTemplates.traceyTenantId, tenantId))
        .orderBy(asc(scShiftTemplates.name)),
    ),
    listActiveSkills(tenantId),
  ]);

  if (locations.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">New shift</h1>
        <p className="text-sm text-muted-foreground">
          You need at least one location before you can create a shift.
        </p>
        <Button asChild>
          <Link href="/app/locations">Add a location</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">New shift</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shifts start as drafts. Publish from the edit page when you're
            ready to offer them to staff.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/schedule">← Back</Link>
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <ShiftForm
          mode="create"
          locations={locations}
          skills={skills}
          templates={templates}
        />
      </section>
    </div>
  );
}
