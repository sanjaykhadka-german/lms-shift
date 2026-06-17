import { and, asc, eq, gte, lt } from "drizzle-orm";
import { forTenant, scShiftAssignments, scShifts } from "@tracey/db";

export interface ScheduledPerson {
  id: string;
  startsAt: string;
  endsAt: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Everyone with an accepted, published shift at `locationId` today. Used by the
 * kiosk roster's "Scheduled" filter. Mirrors the punch screen's shift query
 * (app/kiosk/me/page.tsx) but tenant-wide rather than for one user, and gated
 * to published shifts so drafts never surface on the wall tablet.
 */
export async function loadScheduledTodayAtLocation(
  tenantId: string,
  locationId: string | null,
): Promise<ScheduledPerson[]> {
  if (!locationId) return [];

  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        userId: scShiftAssignments.userId,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShiftAssignments.status, "accepted"),
          eq(scShifts.locationId, locationId),
          eq(scShifts.status, "published"),
          gte(scShifts.startsAt, today),
          lt(scShifts.startsAt, tomorrow),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  // Collapse to one row per person — earliest shift today wins (rows are
  // already ordered by startsAt, so the first seen is the earliest).
  const byUser = new Map<string, ScheduledPerson>();
  for (const r of rows) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, {
        id: r.userId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
      });
    }
  }
  return [...byUser.values()];
}
