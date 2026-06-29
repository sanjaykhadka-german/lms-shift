import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  auditEvents,
  db,
  forTenant,
  scClockEvents,
  scShiftAssignments,
  scShifts,
  scTimesheetApprovals,
  type ScClockEventType,
} from "@tracey/db";
import { fmtIsoDate, startOfWeek, validateTransition } from "./clock-pure";

// Auto clock-out core, extracted from app/app/timesheets/event-actions.ts so
// it can run from BOTH the in-app triggers (manager button + throttled
// page-load sweep) AND the standalone hourly cron
// (scripts/sweep-stale-clock-outs.ts). Deliberately free of Next-only imports
// — no next/cache, no auth, no ~/lib/audit, and NOT `server-only` (it imports
// helpers from ./clock-pure, not ./clock) — so plain `tsx` can load it.
//
// sweepStaleClockIns has NO auth gate and NO revalidate — callers add what
// they need (the action gates + revalidates; the cron iterates tenants).

export const STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;
const SHIFT_MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;

// AUDIT.md #4 — lock clock-event mutations on weeks whose timesheet has been
// approved. Returns null when the week is unlocked, otherwise a human-readable
// refusal reason. Pure check — no audit event, no side effects.
export async function assertWeekUnlocked(
  tenantId: string,
  appUserId: string,
  occurredAt: Date,
): Promise<string | null> {
  const weekStartIso = fmtIsoDate(startOfWeek(occurredAt));
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ status: scTimesheetApprovals.status })
      .from(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, tenantId),
          eq(scTimesheetApprovals.employeeUserId, appUserId),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      )
      .limit(1),
  );
  if (row?.status === "approved") {
    return "Timesheet for this week is approved — reopen it first to edit clock events.";
  }
  return null;
}

// Validates a new event in the context of the user's existing stream by
// walking the active events around its occurredAt and asking
// validateTransition() if it fits. Returns null on OK or an error string.
export async function validateInsertion(
  tenantId: string,
  appUserId: string,
  eventType: ScClockEventType,
  occurredAt: Date,
  excludeEventId?: string,
): Promise<string | null> {
  const stream = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scClockEvents.id,
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
      .orderBy(asc(scClockEvents.occurredAt)),
  );
  // Find the latest active event strictly before occurredAt — excluding the
  // to-be-voided row when this is part of an edit. That's the "prev" state
  // validateTransition() needs.
  let prev: ScClockEventType | undefined = undefined;
  for (const e of stream) {
    if (excludeEventId && e.id === excludeEventId) continue;
    if (e.occurredAt.getTime() >= occurredAt.getTime()) break;
    prev = e.eventType as ScClockEventType;
  }
  return validateTransition(prev, eventType);
}

type ClockStatusLite = "clocked_out" | "working" | "on_break";
interface OpenState {
  status: ClockStatusLite;
  inAt: Date | null;
  lastEventAt: Date | null;
}

// Fold ONE user's chronological (non-voided) events into their current clock
// state: are they still on the clock, when did the open period start, and when
// was their latest event.
function foldClockState(events: { eventType: string; occurredAt: Date }[]): OpenState {
  const s: OpenState = { status: "clocked_out", inAt: null, lastEventAt: null };
  for (const e of events) {
    s.lastEventAt = e.occurredAt;
    switch (e.eventType) {
      case "in":
        if (s.status === "clocked_out") {
          s.status = "working";
          s.inAt = e.occurredAt;
        }
        break;
      case "break_start":
        if (s.status === "working") s.status = "on_break";
        break;
      case "break_end":
        if (s.status === "on_break") s.status = "working";
        break;
      case "out":
        if (s.status !== "clocked_out") {
          s.status = "clocked_out";
          s.inAt = null;
        }
        break;
      default:
        break;
    }
  }
  return s;
}

// Auto clock-out for ONE forgotten punch. Two cases:
//   - SCHEDULED: if a matching accepted shift started >24h ago, close at that
//     shift's scheduled end (the payroll-sane finish).
//   - UNSCHEDULED: no matching accepted shift → close at clock-in + 24h once
//     24h have elapsed since the clock-in.
// Returns "not-stale" if the 24h window hasn't elapsed, "skipped" if a guard
// refused (locked week / invalid transition), or "closed" on success.
async function closeOpenPunch(
  tenantId: string,
  appUserId: string,
  inAt: Date,
  lastEventAt: Date,
  now: Date,
): Promise<"closed" | "skipped" | "not-stale"> {
  // Find the accepted scheduled shift this clock-in belongs to — start within
  // ±12h of the punch (nearest wins).
  const candidates = await forTenant(tenantId).run((tx) =>
    tx
      .select({ startsAt: scShifts.startsAt, endsAt: scShifts.endsAt })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShiftAssignments.status, "accepted"),
          eq(scShiftAssignments.userId, appUserId),
          eq(scShifts.traceyTenantId, tenantId),
          gte(scShifts.startsAt, new Date(inAt.getTime() - SHIFT_MATCH_WINDOW_MS)),
          lt(scShifts.startsAt, new Date(inAt.getTime() + SHIFT_MATCH_WINDOW_MS)),
        ),
      ),
  );
  const shift =
    candidates.length === 0
      ? null
      : candidates.reduce((best, c) =>
          Math.abs(c.startsAt.getTime() - inAt.getTime()) <
          Math.abs(best.startsAt.getTime() - inAt.getTime())
            ? c
            : best,
        );

  let outAt: Date;
  if (shift === null) {
    if (now.getTime() - inAt.getTime() <= STALE_CUTOFF_MS) return "not-stale";
    outAt = new Date(inAt.getTime() + STALE_CUTOFF_MS);
  } else {
    if (now.getTime() - shift.startsAt.getTime() <= STALE_CUTOFF_MS) return "not-stale";
    outAt = shift.endsAt;
  }

  // The closing punch must land after the last existing event, else the
  // stream/transition would be invalid. (Edge: events after scheduled end.)
  if (outAt.getTime() <= lastEventAt.getTime()) return "skipped";
  if (await assertWeekUnlocked(tenantId, appUserId, outAt)) return "skipped";
  if (await validateInsertion(tenantId, appUserId, "out", outAt)) return "skipped";

  let newEventId = "";
  await forTenant(tenantId).run(async (tx) => {
    const [inserted] = await tx
      .insert(scClockEvents)
      .values({
        traceyTenantId: tenantId,
        appUserId,
        eventType: "out",
        occurredAt: outAt,
        source: "admin_edit",
        notes:
          shift === null
            ? "Auto clock-out: still clocked in 24h+ after clock-in."
            : "Auto clock-out: still clocked in 24h+ after scheduled start.",
      })
      .returning({ id: scClockEvents.id });
    newEventId = inserted!.id;
  });

  // Audit as a SYSTEM action (null actor) with an explicit tenantId. We don't
  // use ~/lib/audit here: that helper resolves the actor from the request
  // session, which (a) pulls Next-only imports the cron can't load and (b) is
  // wrong anyway — an auto-close isn't performed by whoever happened to trigger
  // it. Best-effort: never let an audit failure abort the close.
  try {
    await db.insert(auditEvents).values({
      tenantId,
      actorUserId: null,
      actorEmail: null,
      action: "shiftcraft.clock.auto_closed",
      targetKind: "sc_clock_event",
      targetId: newEventId,
      details: {
        appUserId,
        clockInAt: inAt.toISOString(),
        scheduledStart: shift?.startsAt.toISOString() ?? null,
        clockedOutAt: outAt.toISOString(),
      } as never,
    });
  } catch (err) {
    console.error("[clock-sweep] audit insert failed:", err);
  }
  return "closed";
}

// Tenant-wide sweep: close every forgotten punch in the tenant. Used by the
// manual button, the throttled page-load trigger, and the hourly cron.
export async function sweepStaleClockIns(
  tenantId: string,
): Promise<{ closed: number; skipped: number }> {
  const now = new Date();

  // Pull every active (non-voided) event, ordered by user then time, and group
  // per user so each can be folded into its current clock state.
  const events = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        appUserId: scClockEvents.appUserId,
        eventType: scClockEvents.eventType,
        occurredAt: scClockEvents.occurredAt,
      })
      .from(scClockEvents)
      .where(isNull(scClockEvents.voidedAt))
      .orderBy(asc(scClockEvents.appUserId), asc(scClockEvents.occurredAt)),
  );

  const byUser = new Map<string, { eventType: string; occurredAt: Date }[]>();
  for (const e of events) {
    const arr = byUser.get(e.appUserId);
    if (arr) arr.push(e);
    else byUser.set(e.appUserId, [e]);
  }

  let closed = 0;
  let skipped = 0;
  for (const [appUserId, userEvents] of byUser) {
    const s = foldClockState(userEvents);
    if (s.status === "clocked_out" || !s.inAt || !s.lastEventAt) continue;
    const r = await closeOpenPunch(tenantId, appUserId, s.inAt, s.lastEventAt, now);
    if (r === "closed") closed++;
    else if (r === "skipped") skipped++;
  }
  return { closed, skipped };
}

// Self-heal for the clock/kiosk path: close THIS user's still-open clock-in if
// it's gone stale (24h+), BEFORE the action's transition check runs. Lets a
// returning employee whose forgotten punch is 24h+ old clock in cleanly — and
// stops a multi-day "shift" if they instead clock out — even with no cron and
// no admin having opened the timesheet. Cheap: one user's events only. Returns
// true if a punch was closed. Best-effort: a throw is swallowed so it can never
// block the punch the user is actually trying to make.
export async function closeStaleClockInForUser(
  tenantId: string,
  appUserId: string,
): Promise<boolean> {
  try {
    const events = await forTenant(tenantId).run((tx) =>
      tx
        .select({ eventType: scClockEvents.eventType, occurredAt: scClockEvents.occurredAt })
        .from(scClockEvents)
        .where(and(eq(scClockEvents.appUserId, appUserId), isNull(scClockEvents.voidedAt)))
        .orderBy(asc(scClockEvents.occurredAt)),
    );
    const s = foldClockState(events);
    if (s.status === "clocked_out" || !s.inAt || !s.lastEventAt) return false;
    const r = await closeOpenPunch(tenantId, appUserId, s.inAt, s.lastEventAt, new Date());
    return r === "closed";
  } catch (err) {
    console.warn("[closeStaleClockInForUser] failed:", err);
    return false;
  }
}
