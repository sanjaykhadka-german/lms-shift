import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { AreaForm } from "../_form";

export const metadata = { title: "New area · ShiftCraft" };

export default async function NewAreaPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app/areas");
  const tenantId = membership.tenant.id;

  const locations = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scLocations.id, name: scLocations.name })
      .from(scLocations)
      .where(eq(scLocations.traceyTenantId, tenantId))
      .orderBy(asc(scLocations.name)),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            New area
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A scheduling section within a location. New shifts pick an area
            instead of typing a role, keeping the schedule consistent.
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
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a{" "}
            <Link href="/app/locations/new" className="text-primary hover:underline">
              location
            </Link>{" "}
            first — areas belong to a location.
          </p>
        ) : (
          <AreaForm mode="create" locations={locations} />
        )}
      </section>
    </div>
  );
}
