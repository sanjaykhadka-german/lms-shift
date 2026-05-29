import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, ilike, sql } from "drizzle-orm";
import { forTenant, scLocations, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { LocationForm } from "./_form";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Locations · ShiftCraft" };

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim();
  const hasQuery = q.length > 0;

  // Upcoming shift count per location: shifts that are published AND start
  // from now onward. Computed in-DB as a correlated subquery so it scales
  // with locations, not with shifts.
  // ISO string + explicit cast: Drizzle's `sql` template has no column-type
  // info, so a raw `Date` would be handed to postgres-js without a type hint
  // and trip its `Buffer.byteLength(value)` path. Passing text and casting
  // to timestamptz on the server side avoids the issue.
  const nowIso = new Date().toISOString();
  const upcomingCount = sql<number>`(
    SELECT count(*)::int FROM ${scShifts}
    WHERE ${scShifts.locationId} = ${scLocations.id}
      AND ${scShifts.status} = 'published'
      AND ${scShifts.startsAt} >= ${nowIso}::timestamptz
  )`;

  const locations = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scLocations.id,
        name: scLocations.name,
        timezone: scLocations.timezone,
        address: scLocations.address,
        color: scLocations.color,
        dailyWageBudget: scLocations.dailyWageBudget,
        upcomingShifts: upcomingCount,
      })
      .from(scLocations)
      .where(
        hasQuery
          ? and(
              eq(scLocations.traceyTenantId, membership.tenant.id),
              ilike(scLocations.name, `%${q}%`),
            )
          : eq(scLocations.traceyTenantId, membership.tenant.id),
      )
      .orderBy(asc(scLocations.name)),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          Locations
          <InfoPopover label="About locations">
            <p>
              Physical sites where shifts happen. Each location carries
              a timezone, optional geofence (for mobile clock-in), and
              an accent colour used on the schedule + reports.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sites where shifts happen. Add a location before scheduling shifts.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">Add a location</h2>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">
          Timezone affects how shift times display for staff at that site.
        </p>
        <LocationForm mode="create" />
      </section>

      <section className="rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            {hasQuery
              ? `Matches for "${q}" (${locations.length})`
              : `All locations (${locations.length})`}
          </h2>
          <form className="flex items-center gap-2">
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search by name"
              className="h-8 w-48"
            />
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
            {hasQuery && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/app/locations">Clear</Link>
              </Button>
            )}
          </form>
        </div>

        {locations.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            {hasQuery ? "No locations match your search." : "No locations yet — add one above."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {locations.map((loc) => (
              <li
                key={loc.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="h-7 w-1.5 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: loc.color ?? "var(--muted)",
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{loc.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {loc.timezone}
                      {loc.address ? ` · ${loc.address}` : ""}
                      {" · "}
                      {loc.upcomingShifts} upcoming shift
                      {loc.upcomingShifts === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {loc.dailyWageBudget != null && (
                    <span className="hidden whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white sm:inline">
                      ${Math.round(Number(loc.dailyWageBudget)).toLocaleString()}/day budget
                    </span>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/locations/${loc.id}/edit`}>Edit</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
