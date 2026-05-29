import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { ShiftTemplateForm } from "../_form";

export const metadata = { title: "New shift template · ShiftCraft" };

export default async function NewShiftTemplatePage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/shift-templates");

  const locations = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({ id: scLocations.id, name: scLocations.name })
      .from(scLocations)
      .where(eq(scLocations.traceyTenantId, membership.tenant.id))
      .orderBy(asc(scLocations.name)),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            New shift template
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Time-of-day only — when you stamp this onto the schedule
            you'll pick the date.
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
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You need at least one location before you can build a template —{" "}
            <Link href="/app/locations" className="text-primary hover:underline">
              add one
            </Link>{" "}
            first.
          </p>
        ) : (
          <ShiftTemplateForm mode="create" locations={locations} />
        )}
      </section>
    </div>
  );
}
