import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { forTenant, scLocations, scShiftTemplates } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { ShiftTemplateForm } from "../../_form";
import { deleteShiftTemplateAction } from "../../actions";

export const metadata = { title: "Edit shift template · ShiftCraft" };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function EditShiftTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/shift-templates");
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.id, id),
          eq(scShiftTemplates.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) notFound();

  const locations = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scLocations.id, name: scLocations.name })
      .from(scLocations)
      .where(eq(scLocations.traceyTenantId, tenantId))
      .orderBy(asc(scLocations.name)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Edit {row.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Updates take effect the next time you pick this template on
            /app/schedule/new. Shifts already created from it aren't
            touched.
          </p>
        </div>
        <Link
          href="/app/shift-templates"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back
        </Link>
      </div>

      <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <ShiftTemplateForm
          mode="edit"
          templateId={row.id}
          defaultValues={{
            name: row.name,
            locationId: row.locationId,
            role: row.role,
            startsAt: `${pad(row.startHour)}:${pad(row.startMinute)}`,
            endsAt: `${pad(row.endHour)}:${pad(row.endMinute)}`,
            defaultNotes: row.defaultNotes,
          }}
          locations={locations}
        />
      </section>

      <section className="rounded-lg border border-[color:var(--destructive)]/30 bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[color:var(--destructive)]">
          Delete template
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Removes the template only. Shifts already created from it stay
          on the schedule.
        </p>
        <form action={deleteShiftTemplateAction} className="mt-3">
          <input type="hidden" name="id" value={row.id} />
          <Button
            type="submit"
            variant="outline"
            className="text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
          >
            Delete
          </Button>
        </form>
      </section>
    </div>
  );
}
