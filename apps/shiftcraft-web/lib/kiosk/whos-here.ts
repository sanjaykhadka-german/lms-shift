import { and, asc, gte, lt, sql } from "drizzle-orm";
import { db, forTenant, scClockEvents, users } from "@tracey/db";

export interface WhosHerePerson {
  id: string;
  name: string;
  image: string | null;
  since: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Everyone currently on-shift at `locationId` for this tenant today.
 *
 * Walks today's tenant-wide clock-event stream, keeps each user's latest
 * event, and includes them only if that event is `in`/`break_end` AND it
 * happened at this location. Shared by the kiosk landing dashboard and the
 * per-person punch screen so both agree on "who's here".
 */
export async function loadWhosHereAtLocation(
  tenantId: string,
  locationId: string | null,
): Promise<WhosHerePerson[]> {
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todayTenantEvents = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        appUserId: scClockEvents.appUserId,
        eventType: scClockEvents.eventType,
        locationId: scClockEvents.locationId,
        occurredAt: scClockEvents.occurredAt,
      })
      .from(scClockEvents)
      .where(
        and(
          gte(scClockEvents.occurredAt, today),
          lt(scClockEvents.occurredAt, tomorrow),
        ),
      )
      .orderBy(asc(scClockEvents.occurredAt)),
  );

  const lastByUser = new Map<
    string,
    { eventType: string; locationId: string | null; occurredAt: Date }
  >();
  for (const e of todayTenantEvents) {
    lastByUser.set(e.appUserId, e);
  }

  const hereUserIds: string[] = [];
  for (const [uid, last] of lastByUser.entries()) {
    if (
      (last.eventType === "in" || last.eventType === "break_end") &&
      last.locationId === locationId
    ) {
      hereUserIds.push(uid);
    }
  }
  if (hereUserIds.length === 0) return [];

  const peopleRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(sql`${users.id} in ${hereUserIds}`);

  return peopleRows
    .map((p) => ({
      id: p.id,
      name: p.name ?? p.email ?? "—",
      image: p.image,
      since: lastByUser.get(p.id)!.occurredAt.toISOString(),
    }))
    .sort((a, b) => a.since.localeCompare(b.since));
}
