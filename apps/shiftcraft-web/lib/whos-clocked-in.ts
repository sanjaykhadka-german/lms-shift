import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  forTenant,
  scDepartments,
  scEmployees,
  scLocations,
  users,
} from "@tracey/db";
import { getEventsInRangeForTenant } from "~/lib/clock";

// R3 — the tenant-wide "who's clocked in right now" view for the admin
// attendance dashboard. The kiosk's loadWhosHereAtLocation is per-location and
// working-only; this one covers every location, includes on-break people, and
// resolves location + department + the current-segment start so a manager can
// see the whole floor at a glance and spot forgotten punches.

export interface ClockedInPerson {
  userId: string;
  name: string;
  image: string | null;
  status: "working" | "on_break";
  /** When the current segment (work or break) started. */
  sinceIso: string;
  /** First clock-in today — the shift start, for the total-elapsed display. */
  clockedInIso: string;
  locationName: string | null;
  departmentName: string | null;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function loadWhosClockedIn(
  tenantId: string,
): Promise<ClockedInPerson[]> {
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Today's non-voided events, ordered by (user, time) so the last entry per
  // user is their current state.
  const events = await getEventsInRangeForTenant(tenantId, today, tomorrow);

  interface Acc {
    firstInAt: Date | null;
    lastType: string;
    lastAt: Date;
    lastLocationId: string | null;
  }
  const byUser = new Map<string, Acc>();
  for (const e of events) {
    const cur = byUser.get(e.appUserId);
    if (!cur) {
      byUser.set(e.appUserId, {
        firstInAt: e.eventType === "in" ? e.occurredAt : null,
        lastType: e.eventType,
        lastAt: e.occurredAt,
        lastLocationId: e.locationId,
      });
    } else {
      if (cur.firstInAt == null && e.eventType === "in") {
        cur.firstInAt = e.occurredAt;
      }
      cur.lastType = e.eventType;
      cur.lastAt = e.occurredAt;
      cur.lastLocationId = e.locationId;
    }
  }

  const onShift: Array<{
    userId: string;
    status: "working" | "on_break";
    sinceIso: string;
    clockedInIso: string;
    locationId: string | null;
  }> = [];
  for (const [uid, a] of byUser) {
    const status =
      a.lastType === "in" || a.lastType === "break_end"
        ? ("working" as const)
        : a.lastType === "break_start"
          ? ("on_break" as const)
          : null;
    if (!status) continue; // last event was 'out' → not on shift
    onShift.push({
      userId: uid,
      status,
      sinceIso: a.lastAt.toISOString(),
      clockedInIso: (a.firstInAt ?? a.lastAt).toISOString(),
      locationId: a.lastLocationId,
    });
  }
  if (onShift.length === 0) return [];

  const userIds = onShift.map((r) => r.userId);
  const locationIds = [
    ...new Set(
      onShift
        .map((r) => r.locationId)
        .filter((x): x is string => x != null),
    ),
  ];

  const [peopleRows, locationRows, empRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(users)
      .where(inArray(users.id, userIds)),
    locationIds.length > 0
      ? forTenant(tenantId).run((tx) =>
          tx
            .select({ id: scLocations.id, name: scLocations.name })
            .from(scLocations)
            .where(inArray(scLocations.id, locationIds)),
        )
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          appUserId: scEmployees.appUserId,
          departmentName: scDepartments.name,
        })
        .from(scEmployees)
        .leftJoin(
          scDepartments,
          eq(scDepartments.id, scEmployees.departmentId),
        )
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            isNotNull(scEmployees.appUserId),
            inArray(scEmployees.appUserId, userIds),
          ),
        ),
    ),
  ]);

  const nameByUser = new Map(
    peopleRows.map((p) => [
      p.id,
      { name: p.name ?? p.email ?? "—", image: p.image },
    ]),
  );
  const locName = new Map(locationRows.map((l) => [l.id, l.name]));
  const deptByUser = new Map(
    empRows
      .filter((e) => e.appUserId)
      .map((e) => [e.appUserId as string, e.departmentName ?? null]),
  );

  return onShift
    .map((r) => {
      const person = nameByUser.get(r.userId);
      return {
        userId: r.userId,
        name: person?.name ?? "—",
        image: person?.image ?? null,
        status: r.status,
        sinceIso: r.sinceIso,
        clockedInIso: r.clockedInIso,
        locationName: r.locationId ? (locName.get(r.locationId) ?? null) : null,
        departmentName: deptByUser.get(r.userId) ?? null,
      };
    })
    .sort((a, b) => a.clockedInIso.localeCompare(b.clockedInIso));
}
