import "server-only";
import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import {
  forTenant,
  scAreas,
  scLeadAreas,
  scManagerLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// ─── Manager location scope (AUDIT.md #13) ──────────────────────────
//
// Returns the set of location IDs an admin is allowed to operate
// across, OR `null` to mean "no restriction" (the existing UI behavior).
//
// Resolution rules:
//   - role === "owner"                    → null (always full access)
//   - role === "admin", 0 rows            → null (backwards-compat: admins
//                                            keep full access until an owner
//                                            explicitly scopes them)
//   - role === "admin", N rows            → Set<locationId>
//   - role === "location_manager", 0 rows → empty Set (NO access — a location
//                                            manager with no sites assigned
//                                            sees nothing, never everything)
//   - role === "location_manager", N rows → Set<locationId>
//   - role === "member"                   → null (members are gated by
//                                            assignment ownership at a finer
//                                            grain; the manager-scope filter
//                                            doesn't apply)
//
// Callers branch on the null vs Set return:
//
//   const scope = await getManagedLocationIds(tenantId, userId, role);
//   if (scope) {
//     // tighten the query: where locationId = ANY(Array.from(scope))
//   }

export type ManagerScope = Set<string> | null;

export async function getManagedLocationIds(
  tenantId: string,
  userId: string,
  role: string,
): Promise<ManagerScope> {
  if (role === "owner") return null;
  if (role !== "admin" && role !== "location_manager") return null;
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ locationId: scManagerLocations.locationId })
      .from(scManagerLocations)
      .where(
        and(
          eq(scManagerLocations.traceyTenantId, tenantId),
          eq(scManagerLocations.appUserId, userId),
        ),
      ),
  );
  // A location_manager with zero grants is locked to nothing (empty Set), not
  // everything. An admin with zero grants keeps full access (back-compat).
  if (rows.length === 0) return role === "location_manager" ? new Set<string>() : null;
  return new Set(rows.map((r) => r.locationId));
}

// Helper for query construction. Returns an array of UUIDs to feed
// into `where … = ANY($1)` clauses; callers should skip the filter
// entirely when the helper returns null.
export function scopeArray(scope: ManagerScope): string[] | null {
  return scope ? Array.from(scope) : null;
}

// Read-only guard used by single-row endpoints (e.g. /app/schedule/[id]/edit).
// Returns true if the manager can act on the given location. Owners +
// unscoped admins always return true.
export function isLocationInScope(
  scope: ManagerScope,
  locationId: string | null | undefined,
): boolean {
  if (scope === null) return true;
  if (!locationId) return false;
  return scope.has(locationId);
}

// ─── Lead area scope (Access levels — "Lead" tier) ──────────────────
//
// A Lead is an approve-only team supervisor scoped to one or more areas
// (sc_areas) via sc_lead_areas. Unlike admins, a Lead is ALWAYS fail-closed:
// zero grants → sees nothing.
//
//   role !== "lead"        → null  (not applicable; callers use the manager-
//                                    location scope or own-self logic instead)
//   role === "lead", 0 rows → empty Set (NO areas — sees nothing)
//   role === "lead", N rows → Set<areaId>

export type LeadScope = Set<string> | null;

export async function getLeadAreaIds(
  tenantId: string,
  userId: string,
  role: string,
): Promise<LeadScope> {
  if (role !== "lead") return null;
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ areaId: scLeadAreas.areaId })
      .from(scLeadAreas)
      .where(
        and(
          eq(scLeadAreas.traceyTenantId, tenantId),
          eq(scLeadAreas.appUserId, userId),
        ),
      ),
  );
  // Fail closed: a lead with no grants is locked to nothing, never everything.
  return new Set(rows.map((r) => r.areaId));
}

// A Lead's areas resolved to the concrete shape used to filter shifts and
// timesheets. Shifts/timesheets are keyed by (locationId + role-name), where
// role-name is the denormalized sc_areas.name — there is no employee→area
// column — so a Lead's reach is the set of (locationId, areaName) pairs of
// their assigned areas. Returns `locationIds` for coarse location filtering
// and `pairs` for the exact (location, area-name) match.
export interface ResolvedLeadAreas {
  areaIds: Set<string>;
  locationIds: Set<string>;
  pairs: { locationId: string; areaName: string }[];
}

export async function resolveLeadAreas(
  tenantId: string,
  areaIds: Set<string>,
): Promise<ResolvedLeadAreas> {
  if (areaIds.size === 0) {
    return { areaIds, locationIds: new Set(), pairs: [] };
  }
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scAreas.id,
        locationId: scAreas.locationId,
        name: scAreas.name,
      })
      .from(scAreas)
      .where(
        and(
          eq(scAreas.traceyTenantId, tenantId),
          inArray(scAreas.id, Array.from(areaIds)),
        ),
      ),
  );
  const locationIds = new Set<string>();
  const pairs: { locationId: string; areaName: string }[] = [];
  for (const r of rows) {
    locationIds.add(r.locationId);
    pairs.push({ locationId: r.locationId, areaName: r.name });
  }
  return { areaIds, locationIds, pairs };
}

// True if a (locationId, areaName) shift falls inside a Lead's resolved scope.
export function isAreaPairInScope(
  resolved: ResolvedLeadAreas,
  locationId: string | null | undefined,
  areaName: string | null | undefined,
): boolean {
  if (!locationId || !areaName) return false;
  return resolved.pairs.some(
    (p) => p.locationId === locationId && p.areaName === areaName,
  );
}

// A Lead's "team" for a given week: the set of auth-user IDs who are assigned
// to at least one shift in the Lead's area(s) during [weekStart, weekEnd).
// Employees have no direct area column — area membership is expressed through
// shift assignments (sc_shifts.location_id + sc_shifts.role = sc_areas.name) —
// so the team is derived per-week from the published/draft roster.
export async function getLeadTeamUserIds(
  tenantId: string,
  resolved: ResolvedLeadAreas,
  weekStart: Date,
  weekEnd: Date,
): Promise<Set<string>> {
  if (resolved.pairs.length === 0) return new Set();
  const pairConds = resolved.pairs.map((p) =>
    and(eq(scShifts.locationId, p.locationId), eq(scShifts.role, p.areaName)),
  );
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .selectDistinct({ userId: scShiftAssignments.userId })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          gte(scShifts.startsAt, weekStart),
          lt(scShifts.startsAt, weekEnd),
          or(...pairConds),
        ),
      ),
  );
  return new Set(rows.map((r) => r.userId));
}
