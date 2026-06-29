import "server-only";
import { and, asc, desc, eq, gte, isNull, lt } from "drizzle-orm";
import {
  forTenant,
  scClockEvents,
  type ScClockEvent,
  type ScClockEventType,
} from "@tracey/db";
import { type ClockStatus, addDays } from "./clock-pure";

// The pure, DB-free helpers (date math + the transition guard) live in
// ./clock-pure so the hourly cron can import them without pulling in
// `server-only`. Re-exported here so `~/lib/clock` consumers are unchanged.
export * from "./clock-pure";

// ─── Pure derivation helpers (unit-testable) ───────────────────────────────
//
// Clock state is derived from the append-only event stream. Keeping the
// pure functions free of DB dependencies lets vitest exercise edge cases
// (overnight shifts, week boundaries, malformed sequences) without any
// fixtures.

export interface ClockState {
  status: ClockStatus;
  /** Most recent event, if any — handy for showing "since 09:14". */
  lastEvent: ScClockEvent | null;
  /** When the *current* working/break segment started. Null when clocked_out. */
  segmentStartedAt: Date | null;
}

interface InputEvent {
  eventType: ScClockEventType | string;
  occurredAt: Date;
}

/**
 * Walk events in chronological order and return the latest derived state.
 * Malformed transitions (e.g. two consecutive `in` events) are tolerated
 * by leaving the state machine in its current state — the more recent
 * event simply wins for `lastEvent`.
 */
export function deriveClockState(events: ScClockEvent[]): ClockState {
  let status: ClockStatus = "clocked_out";
  let segmentStartedAt: Date | null = null;

  for (const e of events) {
    switch (e.eventType) {
      case "in":
        if (status === "clocked_out") {
          status = "working";
          segmentStartedAt = e.occurredAt;
        }
        break;
      case "break_start":
        if (status === "working") {
          status = "on_break";
          segmentStartedAt = e.occurredAt;
        }
        break;
      case "break_end":
        if (status === "on_break") {
          status = "working";
          segmentStartedAt = e.occurredAt;
        }
        break;
      case "out":
        if (status === "working" || status === "on_break") {
          status = "clocked_out";
          segmentStartedAt = null;
        }
        break;
      default:
        break;
    }
  }

  return {
    status,
    lastEvent: events.length > 0 ? events[events.length - 1]! : null,
    segmentStartedAt,
  };
}

export interface ClockSegment {
  kind: "work" | "break";
  startedAt: Date;
  endedAt: Date;
}

/**
 * Walk events into a list of closed segments. If `now` is provided and the
 * user is mid-segment at the end, the open segment is closed at `now`.
 * Useful for per-day bucketing and CSV export where you want concrete
 * intervals rather than aggregated totals.
 */
export function deriveSegments(events: InputEvent[], now?: Date): ClockSegment[] {
  const out: ClockSegment[] = [];
  let openKind: "work" | "break" | null = null;
  let openAt: Date | null = null;

  const close = (endedAt: Date) => {
    if (!openKind || !openAt) return;
    if (endedAt > openAt) {
      out.push({ kind: openKind, startedAt: openAt, endedAt });
    }
    openKind = null;
    openAt = null;
  };

  for (const e of events) {
    switch (e.eventType) {
      case "in":
        if (!openKind) {
          openKind = "work";
          openAt = e.occurredAt;
        }
        break;
      case "break_start":
        if (openKind === "work") {
          close(e.occurredAt);
          openKind = "break";
          openAt = e.occurredAt;
        }
        break;
      case "break_end":
        if (openKind === "break") {
          close(e.occurredAt);
          openKind = "work";
          openAt = e.occurredAt;
        }
        break;
      case "out":
        close(e.occurredAt);
        break;
    }
  }
  if (openKind && now) close(now);
  return out;
}

/**
 * Split a segment at midnight boundaries so the timesheet's per-day buckets
 * never double-count an overnight shift. Returns 1+ segments, all with
 * `kind` preserved, summing to the original duration.
 */
export function splitSegmentByDay(seg: ClockSegment): ClockSegment[] {
  const out: ClockSegment[] = [];
  let cursor = seg.startedAt;
  while (cursor < seg.endedAt) {
    const dayEnd = new Date(cursor);
    dayEnd.setHours(0, 0, 0, 0);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const chunkEnd = dayEnd < seg.endedAt ? dayEnd : seg.endedAt;
    out.push({ kind: seg.kind, startedAt: cursor, endedAt: chunkEnd });
    cursor = chunkEnd;
  }
  return out;
}

export interface AggregatedTotals {
  workMs: number;
  breakMs: number;
}

/**
 * Sum work / break milliseconds across an ordered event stream.
 *
 * If `now` is provided and the user is still mid-segment at the end of the
 * stream, the open segment is closed at `now` (live elapsed display).
 *
 * Events should already be filtered to a single (user, range) — this
 * function does not re-filter.
 */
export function aggregateClockTotals(
  events: InputEvent[],
  now?: Date,
): AggregatedTotals {
  let workMs = 0;
  let breakMs = 0;
  let openKind: "work" | "break" | null = null;
  let openAt: Date | null = null;

  const flush = (closeAt: Date) => {
    if (!openKind || !openAt) return;
    const delta = closeAt.getTime() - openAt.getTime();
    if (delta > 0) {
      if (openKind === "work") workMs += delta;
      else breakMs += delta;
    }
    openKind = null;
    openAt = null;
  };

  for (const e of events) {
    switch (e.eventType) {
      case "in":
        if (!openKind) {
          openKind = "work";
          openAt = e.occurredAt;
        }
        break;
      case "break_start":
        if (openKind === "work") {
          flush(e.occurredAt);
          openKind = "break";
          openAt = e.occurredAt;
        }
        break;
      case "break_end":
        if (openKind === "break") {
          flush(e.occurredAt);
          openKind = "work";
          openAt = e.occurredAt;
        }
        break;
      case "out":
        if (openKind) flush(e.occurredAt);
        break;
      default:
        break;
    }
  }

  if (openKind && now) flush(now);
  return { workMs, breakMs };
}

// ─── DB-touching helpers ───────────────────────────────────────────────────

/**
 * Load *today's* events for one user — enough to derive current clock state
 * and "elapsed today". Today is interpreted as midnight-to-midnight local.
 * Voided events (admin corrections) are excluded everywhere; the row stays
 * in the table for audit but is invisible to aggregation.
 */
export async function getTodayEventsForUser(
  tenantId: string,
  userId: string,
): Promise<ScClockEvent[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  return forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, userId),
          gte(scClockEvents.occurredAt, today),
          lt(scClockEvents.occurredAt, tomorrow),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(asc(scClockEvents.occurredAt)),
  );
}

/**
 * Load the single most recent event for a user (any time) — used when we
 * need to know "is this person currently clocked in?" without pulling a
 * full day.
 */
export async function getLatestEventForUser(
  tenantId: string,
  userId: string,
): Promise<ScClockEvent | null> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, userId),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(desc(scClockEvents.occurredAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Load all events for a user inside [from, to). Used by the timesheet
 * aggregation for a given week.
 */
export async function getEventsInRangeForUser(
  tenantId: string,
  userId: string,
  from: Date,
  to: Date,
): Promise<ScClockEvent[]> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, userId),
          gte(scClockEvents.occurredAt, from),
          lt(scClockEvents.occurredAt, to),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(asc(scClockEvents.occurredAt)),
  );
}

/**
 * Load all events for a whole tenant in [from, to). Used by the admin
 * timesheet view and the "who's on the floor" dashboard widget.
 */
export async function getEventsInRangeForTenant(
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ScClockEvent[]> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scClockEvents)
      .where(
        and(
          gte(scClockEvents.occurredAt, from),
          lt(scClockEvents.occurredAt, to),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(asc(scClockEvents.appUserId), asc(scClockEvents.occurredAt)),
  );
}
