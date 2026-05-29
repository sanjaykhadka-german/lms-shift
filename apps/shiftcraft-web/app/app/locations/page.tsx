import { MapPin, Trash2 } from "lucide-react";
import { requireMembership } from "~/lib/auth/current";
import { listLocations, COMMON_TIMEZONES } from "~/lib/shiftcraft/locations";
import { Button } from "~/components/ui/button";
import { CreateLocationForm } from "./_form";
import { deleteLocationAction } from "./actions";

export default async function LocationsPage() {
  const { tenant, role } = await requireMembership();
  const locations = await listLocations(tenant.id);
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <MapPin className="h-6 w-6 text-primary" strokeWidth={2} />
          Locations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Physical sites where shifts happen. Shifts are scheduled per location.
        </p>
      </header>

      {canManage && (
        <section className="mb-10 rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold">Add a location</h2>
          <CreateLocationForm timezones={COMMON_TIMEZONES} />
        </section>
      )}

      <section className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">
            {locations.length} {locations.length === 1 ? "location" : "locations"}
          </h2>
        </div>
        {locations.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No locations yet.{" "}
            {canManage
              ? "Add your first one above."
              : "An owner or admin needs to add one."}
          </p>
        ) : (
          <ul className="divide-y">
            {locations.map((loc) => (
              <li key={loc.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <div className="font-medium">{loc.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {loc.timezone}
                    {loc.address ? ` · ${loc.address}` : ""}
                  </div>
                </div>
                {canManage && (
                  <form action={deleteLocationAction}>
                    <input type="hidden" name="id" value={loc.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${loc.name}`}
                      className="text-muted-foreground hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
