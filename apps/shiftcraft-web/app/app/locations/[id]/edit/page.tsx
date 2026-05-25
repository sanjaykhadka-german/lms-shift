import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { forTenant, scLocations } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { LocationForm } from "../../_form";
import { deleteLocationAction } from "../../actions";

export const metadata = { title: "Edit location · ShiftCraft" };

export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const [location] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scLocations.id,
        name: scLocations.name,
        timezone: scLocations.timezone,
        address: scLocations.address,
        color: scLocations.color,
        lat: scLocations.lat,
        lng: scLocations.lng,
        geofenceRadiusM: scLocations.geofenceRadiusM,
      })
      .from(scLocations)
      .where(
        and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, membership.tenant.id)),
      )
      .limit(1),
  );

  if (!location) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit {location.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update the site details. Existing shifts keep their times.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/locations">← Back to locations</Link>
        </Button>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <LocationForm
          mode="edit"
          locationId={location.id}
          defaultValues={{
            name: location.name,
            timezone: location.timezone,
            address: location.address,
            color: location.color,
            lat: location.lat,
            lng: location.lng,
            geofenceRadiusM: location.geofenceRadiusM,
          }}
        />
      </section>

      <section className="rounded-lg border border-destructive/40 bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Deleting removes this location permanently. Shifts associated with it
          are not deleted but will lose their site assignment.
        </p>
        <form action={deleteLocationAction}>
          <input type="hidden" name="id" value={location.id} />
          <Button
            type="submit"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            Delete location
          </Button>
        </form>
      </section>
    </div>
  );
}
