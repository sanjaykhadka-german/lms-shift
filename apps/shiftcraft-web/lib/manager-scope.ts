import "server-only";
import { and, eq } from "drizzle-orm";
import { forTenant, scManagerLocations } from "@tracey/db";

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
