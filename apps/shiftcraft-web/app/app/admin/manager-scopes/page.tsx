import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scAreas,
  scLeadAreas,
  scLocations,
  scManagerLocations,
  users,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAdmin as isOwnerLevel } from "~/lib/roles";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import { listLocationsLite } from "~/lib/daily-sales";
import {
  clearScopeAction,
  grantScopeAction,
  grantLeadAreaAction,
  revokeLeadAreaAction,
  revokeScopeAction,
} from "./actions";

export const metadata = { title: "Access scopes · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function ManagerScopesPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isOwnerLevel(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // Site Managers (role=location_manager) plus full Admins (role=admin) in
  // app.members. Owners are intentionally excluded — they always see
  // everything, so no scope rows apply. The two differ on the empty case: an
  // admin with no rows keeps full access; a Site Manager with no rows has NO
  // access until granted (see lib/manager-scope.ts).
  const [siteManagers, leads] = await Promise.all([
    db
      .select({
        userId: members.userId,
        role: members.role,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(
        and(
          eq(members.tenantId, tenantId),
          inArray(members.role, ["admin", "location_manager"]),
        ),
      )
      .orderBy(asc(users.name), asc(users.email)),
    db
      .select({
        userId: members.userId,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(and(eq(members.tenantId, tenantId), eq(members.role, "lead")))
      .orderBy(asc(users.name), asc(users.email)),
  ]);

  const [locations, scopes, areas, leadScopes] = await Promise.all([
    listLocationsLite(tenantId),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          appUserId: scManagerLocations.appUserId,
          locationId: scManagerLocations.locationId,
        })
        .from(scManagerLocations)
        .where(eq(scManagerLocations.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scAreas.id,
          name: scAreas.name,
          locationId: scAreas.locationId,
        })
        .from(scAreas)
        .where(eq(scAreas.traceyTenantId, tenantId))
        .orderBy(asc(scAreas.sortOrder), asc(scAreas.name)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          appUserId: scLeadAreas.appUserId,
          areaId: scLeadAreas.areaId,
        })
        .from(scLeadAreas)
        .where(eq(scLeadAreas.traceyTenantId, tenantId)),
    ),
  ]);

  const scopesByUser = new Map<string, Set<string>>();
  for (const s of scopes) {
    const set = scopesByUser.get(s.appUserId) ?? new Set<string>();
    set.add(s.locationId);
    scopesByUser.set(s.appUserId, set);
  }

  const leadScopesByUser = new Map<string, Set<string>>();
  for (const s of leadScopes) {
    const set = leadScopesByUser.get(s.appUserId) ?? new Set<string>();
    set.add(s.areaId);
    leadScopesByUser.set(s.appUserId, set);
  }

  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));
  // Areas grouped by location for a readable picker.
  const areasByLocation = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const a of areas) {
    const list = areasByLocation.get(a.locationId) ?? [];
    list.push({ id: a.id, name: a.name });
    areasByLocation.set(a.locationId, list);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Access scopes
          <InfoPopover label="About access scopes">
            <p>
              Restrict a <strong>Site Manager</strong> to specific locations
              and a <strong>Lead</strong> to specific areas/teams. Owners and
              full Admins always see everything regardless.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Owners and full Admins always have workspace-wide access. Use the
          sections below to scope Site Managers to their site(s) and Leads to
          their team(s).
        </p>
      </div>

      {/* ─── Site Managers → locations ─── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">
            Site Managers → locations
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A Site Manager with no assigned locations sees nothing; a full
            Admin with none keeps full cross-location access (the default).
            Assigning locations narrows their view of{" "}
            <strong>Schedule</strong> and <strong>Coverage gaps</strong> to
            just those sites.
          </p>
        </div>
        {siteManagers.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            No Admin- or Site Manager-role members yet. Set someone&rsquo;s
            access level on the Team members page first.
          </p>
        ) : locations.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            Create at least one location before assigning scopes.
          </p>
        ) : (
          <ul className="space-y-3">
            {siteManagers.map((a) => {
              const userScope = scopesByUser.get(a.userId) ?? new Set<string>();
              const isUnscoped = userScope.size === 0;
              const isSiteMgr = a.role === "location_manager";
              return (
                <li
                  key={a.userId}
                  className="rounded-lg border border-border bg-card p-5 shadow-sm"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {a.name ?? a.email}
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {isSiteMgr ? "Site Manager" : "Admin"}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.email}
                      </div>
                    </div>
                    {isUnscoped ? (
                      <span
                        className={
                          isSiteMgr
                            ? "inline-flex items-center rounded-full bg-[color:var(--destructive)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                            : "inline-flex items-center rounded-full bg-[var(--accent-deep)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-ink)]"
                        }
                      >
                        {isSiteMgr ? "No locations yet" : "Full access"}
                      </span>
                    ) : !isSiteMgr ? (
                      <form action={clearScopeAction}>
                        <input type="hidden" name="appUserId" value={a.userId} />
                        <Button type="submit" size="sm" variant="outline">
                          Grant full access
                        </Button>
                      </form>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {locations.map((loc) => {
                      const assigned = userScope.has(loc.id);
                      return (
                        <form
                          key={loc.id}
                          action={
                            assigned ? revokeScopeAction : grantScopeAction
                          }
                        >
                          <input
                            type="hidden"
                            name="appUserId"
                            value={a.userId}
                          />
                          <input
                            type="hidden"
                            name="locationId"
                            value={loc.id}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant={assigned ? "default" : "outline"}
                          >
                            {assigned ? "✓ " : ""}
                            {loc.name}
                          </Button>
                        </form>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ─── Leads → areas ─── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">
            Leads → areas
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A Lead views their team&rsquo;s schedule (read-only) and approves
            their team&rsquo;s timesheets, scoped to the area(s) assigned here.
            A Lead with no areas sees nothing.
          </p>
        </div>
        {leads.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            No Lead-role members yet. Set someone&rsquo;s access level to Lead
            on the Team members page first.
          </p>
        ) : areas.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
            Create at least one area before assigning Lead scopes.
          </p>
        ) : (
          <ul className="space-y-3">
            {leads.map((a) => {
              const userScope =
                leadScopesByUser.get(a.userId) ?? new Set<string>();
              const isUnscoped = userScope.size === 0;
              return (
                <li
                  key={a.userId}
                  className="rounded-lg border border-border bg-card p-5 shadow-sm"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {a.name ?? a.email}
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Lead
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.email}
                      </div>
                    </div>
                    {isUnscoped ? (
                      <span className="inline-flex items-center rounded-full bg-[color:var(--destructive)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white">
                        No areas yet
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {Array.from(areasByLocation.entries()).map(
                      ([locId, locAreas]) => (
                        <div key={locId}>
                          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                            {locationNameById.get(locId) ?? "Location"}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {locAreas.map((area) => {
                              const assigned = userScope.has(area.id);
                              return (
                                <form
                                  key={area.id}
                                  action={
                                    assigned
                                      ? revokeLeadAreaAction
                                      : grantLeadAreaAction
                                  }
                                >
                                  <input
                                    type="hidden"
                                    name="appUserId"
                                    value={a.userId}
                                  />
                                  <input
                                    type="hidden"
                                    name="areaId"
                                    value={area.id}
                                  />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant={assigned ? "default" : "outline"}
                                  >
                                    {assigned ? "✓ " : ""}
                                    {area.name}
                                  </Button>
                                </form>
                              );
                            })}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
