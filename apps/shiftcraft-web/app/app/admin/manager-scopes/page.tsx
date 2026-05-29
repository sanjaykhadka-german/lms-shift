import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
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
  revokeScopeAction,
} from "./actions";

export const metadata = { title: "Manager scopes · ShiftCraft" };
export const dynamic = "force-dynamic";

export default async function ManagerScopesPage() {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isOwnerLevel(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  // List of tenant admins (role=admin in app.members). Owners are
  // intentionally excluded — they always see everything, no scope
  // rows would apply.
  const admins = await db
    .select({
      userId: members.userId,
      name: users.name,
      email: users.email,
    })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.tenantId, tenantId), eq(members.role, "admin")))
    .orderBy(asc(users.name), asc(users.email));

  const [locations, scopes] = await Promise.all([
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
  ]);

  const scopesByUser = new Map<string, Set<string>>();
  for (const s of scopes) {
    const set = scopesByUser.get(s.appUserId) ?? new Set<string>();
    set.add(s.locationId);
    scopesByUser.set(s.appUserId, set);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
          Manager scopes
          <InfoPopover label="About manager scopes">
            <p>
              Restrict an admin&rsquo;s view of{" "}
              <strong>Schedule</strong> and <strong>Coverage gaps</strong>{" "}
              to specific locations. Empty assignment = full access (the
              default). Owners always see everything regardless.
            </p>
            <p className="mt-1">
              Scoped admins can&rsquo;t see or edit shifts at locations
              outside their assignment, and the location filter is
              narrowed to match.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Restrict each admin to specific locations. An admin with no
          assigned locations keeps full cross-location access (the
          default). Assigning one or more locations narrows their view
          of <strong>Schedule</strong> and <strong>Coverage gaps</strong>{" "}
          to just those locations. Owners always see everything.
        </p>
      </div>

      {admins.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          <p>
            No admin-role members on this workspace. Promote someone to
            admin via the Members page before assigning scopes.
          </p>
        </section>
      ) : locations.length === 0 ? (
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          <p>Create at least one location before assigning scopes.</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {admins.map((a) => {
            const userScope = scopesByUser.get(a.userId) ?? new Set<string>();
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
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.email}
                    </div>
                  </div>
                  {isUnscoped ? (
                    <span className="inline-flex items-center rounded-full bg-[var(--accent-deep)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-ink)]">
                      Full access
                    </span>
                  ) : (
                    <form action={clearScopeAction}>
                      <input type="hidden" name="appUserId" value={a.userId} />
                      <Button type="submit" size="sm" variant="outline">
                        Grant full access
                      </Button>
                    </form>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {locations.map((loc) => {
                    const assigned = userScope.has(loc.id);
                    return (
                      <form
                        key={loc.id}
                        action={assigned ? revokeScopeAction : grantScopeAction}
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
    </div>
  );
}
