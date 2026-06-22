import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  scAnnouncements,
  scClockEvents,
  scEmployees,
  scKioskDevices,
  scLocations,
  scShiftAssignments,
  scShifts,
  users,
  type ScClockEventType,
} from "@tracey/db";
import {
  KIOSK_ACTOR_COOKIE,
  KIOSK_DEVICE_COOKIE,
  verifyActorCookie,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import { aggregateClockTotals, stateFor } from "~/lib/clock";
import { PunchScreen } from "./_punch";

export const metadata = { title: "Kiosk · Punch" };
export const dynamic = "force-dynamic";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

export default async function KioskMePage() {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  const actorClaim = verifyActorCookie(
    cookieStore.get(KIOSK_ACTOR_COOKIE)?.value,
  );
  if (
    !deviceClaim ||
    !actorClaim ||
    actorClaim.deviceId !== deviceClaim.deviceId
  ) {
    redirect("/kiosk");
  }

  const tenantId = deviceClaim.tenantId;
  const locationId = deviceClaim.locationId;
  const appUserId = actorClaim.appUserId;
  const today = startOfToday();
  const tomorrow = endOfToday();

  // User profile from the shared app schema. Always present (FK guarantees
  // it exists because the PIN row references app.users on delete cascade).
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, appUserId))
    .limit(1);
  if (!user) redirect("/kiosk");

  // Everything else lives in the per-tenant schema.
  const [
    deviceRows,
    employeeRows,
    locationRows,
    latestUserEventRows,
    todayTenantEvents,
    todayShifts,
    pinnedAnnouncementRows,
  ] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({ requireSelfie: scKioskDevices.requireSelfie })
        .from(scKioskDevices)
        .where(eq(scKioskDevices.id, deviceClaim.deviceId))
        .limit(1),
    ),
    // Preferred display name is the employee's full_name; users.name is often
    // null for staff added via the People page (same as the kiosk roster).
    forTenant(tenantId).run((tx) =>
      tx
        .select({ fullName: scEmployees.fullName })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.appUserId, appUserId),
          ),
        )
        .limit(1),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({ name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.id, locationId))
        .limit(1),
    ),
    // The user's *latest* event regardless of calendar day — this drives
    // the current clock state and the valid punch transitions. It must NOT
    // be scoped to today: kioskPunchAction validates against the all-time
    // last event, so if we only looked at today, someone who never clocked
    // out yesterday would see a "Clock in" button here that the server then
    // rejects with "You're already clocked in." Voided events are excluded
    // to match the punch action's guard exactly.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          eventType: scClockEvents.eventType,
          occurredAt: scClockEvents.occurredAt,
        })
        .from(scClockEvents)
        .where(
          and(
            eq(scClockEvents.appUserId, appUserId),
            isNull(scClockEvents.voidedAt),
          ),
        )
        .orderBy(desc(scClockEvents.occurredAt))
        .limit(1),
    ),
    // Today's events across the whole tenant — used to compute the
    // "who's here now at this location" wall.
    forTenant(tenantId).run((tx) =>
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
    ),
    // Today's accepted shifts for this user at this location.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          role: scShifts.role,
          breaks: scShifts.breaks,
          notes: scShifts.notes,
        })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .where(
          and(
            eq(scShiftAssignments.userId, appUserId),
            eq(scShiftAssignments.status, "accepted"),
            eq(scShifts.locationId, locationId),
            gte(scShifts.startsAt, today),
            lt(scShifts.startsAt, tomorrow),
          ),
        )
        .orderBy(asc(scShifts.startsAt)),
    ),
    // Top pinned announcement, if any. v1 shows it on every visit (no
    // per-user read-tracking yet — see plan's "out of scope" notes).
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          title: scAnnouncements.title,
          body: scAnnouncements.body,
        })
        .from(scAnnouncements)
        .where(
          and(
            eq(scAnnouncements.traceyTenantId, tenantId),
            eq(scAnnouncements.pinned, true),
            or(
              isNull(scAnnouncements.expiresAt),
              sql`${scAnnouncements.expiresAt} > now()`,
            ),
          ),
        )
        .orderBy(sql`${scAnnouncements.createdAt} desc`)
        .limit(1),
    ),
  ]);

  const requireSelfie = deviceRows[0]?.requireSelfie ?? true;
  const locationName = locationRows[0]?.name ?? "—";

  // Derive status straight from the latest event (the single-event stream
  // can't go through deriveClockState, which expects a full ordered stream
  // starting at an `in`). stateFor maps a lone last-event type to the right
  // status, and that event's timestamp is the current segment's start.
  const lastEventType =
    (latestUserEventRows[0]?.eventType ?? null) as ScClockEventType | null;
  const clockStatus = stateFor(lastEventType ?? undefined);
  const segmentStartedAt =
    clockStatus === "clocked_out"
      ? null
      : (latestUserEventRows[0]?.occurredAt ?? null);

  const todayShift = todayShifts[0]
    ? {
        startsAt: todayShifts[0].startsAt.toISOString(),
        endsAt: todayShifts[0].endsAt.toISOString(),
        role: todayShifts[0].role,
        breaks: todayShifts[0].breaks ?? [],
        notes: todayShifts[0].notes,
      }
    : null;

  // How many breaks this user has started today — surfaced on the kiosk so the
  // multi-break flow is visible against the scheduled breaks above.
  const breaksTaken = todayTenantEvents.filter(
    (e) => e.appUserId === appUserId && e.eventType === "break_start",
  ).length;

  // Hours worked so far today: aggregate this user's clock events (the
  // open segment is closed at "now" for a live-ish figure on page load).
  const myEventsToday = todayTenantEvents
    .filter((e) => e.appUserId === appUserId)
    .map((e) => ({ eventType: e.eventType, occurredAt: e.occurredAt }));
  const { workMs: workedTodayMs } = aggregateClockTotals(
    myEventsToday,
    new Date(),
  );

  const announcement = pinnedAnnouncementRows[0] ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <PunchScreen
        user={{
          name: employeeRows[0]?.fullName ?? user.name ?? user.email ?? "—",
          image: user.image,
        }}
        clockStatus={clockStatus}
        lastEventType={lastEventType}
        segmentStartedAt={segmentStartedAt?.toISOString() ?? null}
        locationName={locationName}
        todayShift={todayShift}
        breaksTaken={breaksTaken}
        workedTodayMs={workedTodayMs}
        announcement={announcement}
        requireSelfie={requireSelfie}
      />
    </main>
  );
}
