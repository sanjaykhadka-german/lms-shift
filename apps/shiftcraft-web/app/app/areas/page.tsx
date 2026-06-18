import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { forTenant, scAreas, scLocations, scShifts } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Areas · ShiftCraft" };

export default async function AreasPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");

  const { added } = await searchParams;
  const tenantId = membership.tenant.id;

  // Shifts referencing this area (matched on location + role, since the area
  // name lives on sc_shifts.role).
  const shiftCount = sql<number>`(
    SELECT count(*)::int FROM ${scShifts}
    WHERE ${scShifts.locationId} = ${scAreas.locationId}
      AND ${scShifts.role} = ${scAreas.name}
  )`;

  const [locations, areas] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name, color: scLocations.color })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scAreas.id,
          locationId: scAreas.locationId,
          name: scAreas.name,
          color: scAreas.color,
          shifts: shiftCount,
        })
        .from(scAreas)
        .where(eq(scAreas.traceyTenantId, tenantId))
        .orderBy(asc(scAreas.name)),
    ),
  ]);

  const byLocation = new Map<string, typeof areas>();
  for (const a of areas) {
    const arr = byLocation.get(a.locationId) ?? [];
    arr.push(a);
    byLocation.set(a.locationId, arr);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Areas
            <InfoPopover label="About areas">
              <p>
                Areas are the scheduling sections within a location (e.g.
                Butchery, Front Counter). The{" "}
                <a href="/app/schedule" className="underline">
                  Schedule
                </a>{" "}
                groups rows by area, and the New-shift form picks an area
                instead of free text — so role names stay consistent. Renaming
                an area updates its existing shifts automatically.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {areas.length} area{areas.length === 1 ? "" : "s"} across{" "}
            {locations.length} location{locations.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button asChild>
          <Link href="/app/areas/new">New area</Link>
        </Button>
      </div>

      {added === "1" && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          Area created.
        </div>
      )}

      {locations.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-5 py-6 text-sm text-muted-foreground shadow-sm">
          Add a{" "}
          <Link href="/app/locations/new" className="text-primary hover:underline">
            location
          </Link>{" "}
          first — areas belong to a location.
        </p>
      ) : (
        locations.map((loc) => {
          const list = byLocation.get(loc.id) ?? [];
          return (
            <section
              key={loc.id}
              className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
            >
              <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-5 py-2.5">
                {loc.color && (
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: loc.color }}
                  />
                )}
                <span className="text-sm font-semibold">{loc.name}</span>
                <span className="text-xs text-muted-foreground">
                  {list.length} area{list.length === 1 ? "" : "s"}
                </span>
              </div>
              {list.length === 0 ? (
                <p className="px-5 py-4 text-xs text-muted-foreground">
                  No areas here yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {list.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: a.color ?? loc.color ?? "var(--ink-3)" }}
                        />
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className="inline-flex items-center rounded-full bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                          {a.shifts} {a.shifts === 1 ? "shift" : "shifts"}
                        </span>
                      </div>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/app/areas/${a.id}/edit`}>Edit</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
