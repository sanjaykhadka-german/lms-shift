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

// Auto clock-out for forgotten punches. For every employee still clocked in,
// insert a closing `out` event, source 'admin_edit'. Two cases:
//   - SCHEDULED: if a matching accepted shift started >24h ago, close at that
//     shift's scheduled end (the payroll-sane finish).
//   - UNSCHEDULED: an open punch with no matching accepted shift is closed at
//     clock-in + 24h once 24h have elapsed since the clock-in.
// A punch whose relevant 24h window hasn't elapsed yet is left alone. Locked
// (approved) weeks and invalid transitions are skipped.
export async function sweepStaleClockIns(
  tenantId: string,
): Promise<{ closed: number; skipped: number }> {
  const now = new Date();

  // 1. Pull every active (non-voided) event, ordered by user then time, and
  //    derive each user's current open clock-in (the `in` that started the
  //    still-open work period) plus their latest event.
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

  interface OpenUser {
    appUserId: string;
    inAt: Date;
    lastEventAt: Date;
  }
  type ClockStatusLite = "clocked_out" | "working" | "on_break";
  const open = new Map<string, { status: ClockStatusLite; inAt: Date | null; lastEventAt: Date }>();
  for (const e of events) {
    let s = open.get(e.appUserId);
    if (!s) {
      s = { status: "clocked_out", inAt: null, lastEventAt: e.occurredAt };
      open.set(e.appUserId, s);
    }
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
  const openUsers: OpenUser[] = [...open.entries()]
    .filter(([, s]) => s.status !== "clocked_out" && s.inAt !== null)
    .map(([appUserId, s]) => ({ appUserId, inAt: s.inAt!, lastEventAt: s.lastEventAt }));

  let closed = 0;
  let skipped = 0;

  for (const u of openUsers) {
    // 2. Find the accepted scheduled shift this clock-in belongs to — the one
    //    whose start sits within ±12h of the punch (nearest wins).
    const candidates = await forTenant(tenantId).run((tx) =>
      tx
        .select({ startsAt: scShifts.startsAt, endsAt: scShifts.endsAt })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .where(
          and(
            eq(scShiftAssignments.status, "accepted"),
            eq(scShiftAssignments.userId, u.appUserId),
            eq(scShifts.traceyTenantId, tenantId),
            gte(scShifts.startsAt, new Date(u.inAt.getTime() - SHIFT_MATCH_WINDOW_MS)),
            lt(scShifts.startsAt, new Date(u.inAt.getTime() + SHIFT_MATCH_WINDOW_MS)),
          ),
        ),
    );
    const shift =
      candidates.length === 0
        ? null
        : candidates.reduce((best, c) =>
            Math.abs(c.startsAt.getTime() - u.inAt.getTime()) <
            Math.abs(best.startsAt.getTime() - u.inAt.getTime())
              ? c
              : best,
          );

    // 3. Decide the closing time:
    //    - Scheduled: close at the shift's scheduled end, once 24h have elapsed
    //      since the scheduled start.
    //    - Unscheduled: close at clock-in + 24h, once 24h have elapsed since the
    //      clock-in (mirrors the visitor sweep's signedInAt + 12h).
    let outAt: Date;
    if (shift === null) {
      if (now.getTime() - u.inAt.getTime() <= STALE_CUTOFF_MS) continue;
      outAt = new Date(u.inAt.getTime() + STALE_CUTOFF_MS);
    } else {
      if (now.getTime() - shift.startsAt.getTime() <= STALE_CUTOFF_MS) continue;
      outAt = shift.endsAt;
    }
    // The closing punch must land after the last existing event, else the
    // stream/transition would be invalid. (Edge: events after scheduled end.)
    if (outAt.getTime() <= u.lastEventAt.getTime()) {
      skipped++;
      continue;
    }

    const lockErr = await assertWeekUnlocked(tenantId, u.appUserId, outAt);
    if (lockErr) {
      skipped++;
      continue;
    }
    const stateErr = await validateInsertion(tenantId, u.appUserId, "out", outAt);
    if (stateErr) {
      skipped++;
      continue;
    }

    let newEventId = "";
    await forTenant(tenantId).run(async (tx) => {
      const [inserted] = await tx
        .insert(scClockEvents)
        .values({
          traceyTenantId: tenantId,
          appUserId: u.appUserId,
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
    // wrong anyway — an auto-close isn't performed by whoever happened to load
    // the page. Best-effort: never let an audit failure abort the sweep.
    try {
      await db.insert(auditEvents).values({
        tenantId,
        actorUserId: null,
        actorEmail: null,
        action: "shiftcraft.clock.auto_closed",
        targetKind: "sc_clock_event",
        targetId: newEventId,
        details: {
          appUserId: u.appUserId,
          clockInAt: u.inAt.toISOString(),
          scheduledStart: shift?.startsAt.toISOString() ?? null,
          clockedOutAt: outAt.toISOString(),
        } as never,
      });
    } catch (err) {
      console.error("[clock-sweep] audit insert failed:", err);
    }
    closed++;
  }

  return { closed, skipped };
}
