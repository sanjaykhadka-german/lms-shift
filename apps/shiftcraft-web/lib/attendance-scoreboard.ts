import { deriveSegments, splitSegmentByDay } from "./clock";

// Tunables. Kept as exported consts (not env / tenant settings) for v1 —
// promote to tenant settings when an operator asks for a different policy.
export const LATE_GRACE_MS = 5 * 60_000; // 5 min — clock-in past this counts as late
export const OT_GRACE_MS = 15 * 60_000; // 15 min — work past shift end inside this is not OT

export interface ShiftInput {
  userId: string;
  startsAt: Date;
  endsAt: Date;
  locationId: string | null;
}

export interface ClockEventInput {
  userId: string;
  eventType: "in" | "out" | "break_start" | "break_end" | string;
  occurredAt: Date;
}

export interface UserScore {
  scheduled: number;
  attended: number;
  noShows: number;
  lateCount: number;
  /** Sum of (firstIn - shiftStart) across late shifts. */
  lateMs: number;
  /** Work logged beyond shift.endsAt + OT_GRACE_MS, summed across all shifts in non-approved weeks. */
  unapprovedOtMs: number;
  totalWorkMs: number;
}

const dayKey = (d: Date): string => {
  const z = new Date(d);
  z.setHours(0, 0, 0, 0);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`;
};

// Monday-start ISO week key, matching `startOfWeek` in lib/clock.
const weekKey = (d: Date): string => {
  const dow = (d.getDay() + 6) % 7;
  const z = new Date(d);
  z.setHours(0, 0, 0, 0);
  z.setDate(z.getDate() - dow);
  return dayKey(z);
};

const emptyScore = (): UserScore => ({
  scheduled: 0,
  attended: 0,
  noShows: 0,
  lateCount: 0,
  lateMs: 0,
  unapprovedOtMs: 0,
  totalWorkMs: 0,
});

export interface BuildScoreboardArgs {
  shifts: ShiftInput[];
  events: ClockEventInput[];
  /** Set of "${userId}|${weekStartISODate}" for approved-status timesheet weeks. */
  approvedWeeks: Set<string>;
  /** Optional location filter — when set, only shifts at this location count. */
  locationId?: string | null;
}

/**
 * Build per-user attendance counters across a period. Pure — no DB. The
 * page is responsible for fetching shifts, clock events, and approval rows
 * then handing them in.
 */
export function buildScoreboard({
  shifts,
  events,
  approvedWeeks,
  locationId,
}: BuildScoreboardArgs): Map<string, UserScore> {
  const filteredShifts = locationId
    ? shifts.filter((s) => s.locationId === locationId)
    : shifts;

  // Group events per user and derive segments once. Voided events should
  // already be filtered out at the query layer.
  const eventsByUser = new Map<string, ClockEventInput[]>();
  for (const e of events) {
    const arr = eventsByUser.get(e.userId) ?? [];
    arr.push(e);
    eventsByUser.set(e.userId, arr);
  }
  // Per-user data we need downstream:
  //   workMs          — running total for the "hours worked" column
  //   workMsByDay     — local-day buckets used by no-show detection
  //   workSegments    — flat list (absolute time) for OT overlap maths
  //   firstInByDay    — first `in` event per local day for lateness
  // Day-bucketing the segments themselves doesn't work for OT because a
  // shift's OT cutoff is in absolute time and may sit on the *next* local
  // day after a long evening shift; the flat list keeps the OT scan
  // correct regardless of how `splitSegmentByDay` chopped the work.
  const segmentsByUser = new Map<
    string,
    {
      workMs: number;
      workMsByDay: Map<string, number>;
      workSegments: { startedAt: Date; endedAt: Date }[];
      firstInByDay: Map<string, Date>;
    }
  >();
  for (const [uid, evs] of eventsByUser) {
    const sorted = [...evs].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const segs = deriveSegments(sorted);
    let total = 0;
    const workMsByDay = new Map<string, number>();
    const workSegments: { startedAt: Date; endedAt: Date }[] = [];
    const firstInByDay = new Map<string, Date>();
    for (const seg of segs) {
      if (seg.kind !== "work") continue;
      workSegments.push({ startedAt: seg.startedAt, endedAt: seg.endedAt });
      for (const chunk of splitSegmentByDay(seg)) {
        const k = dayKey(chunk.startedAt);
        const ms = chunk.endedAt.getTime() - chunk.startedAt.getTime();
        total += ms;
        workMsByDay.set(k, (workMsByDay.get(k) ?? 0) + ms);
      }
    }
    // First `in` event per local day — used for lateness. Walk raw events
    // rather than segments so a `break_end` inside a long shift doesn't
    // look like a fresh arrival.
    for (const e of sorted) {
      if (e.eventType !== "in") continue;
      const k = dayKey(e.occurredAt);
      if (!firstInByDay.has(k)) firstInByDay.set(k, e.occurredAt);
    }
    segmentsByUser.set(uid, { workMs: total, workMsByDay, workSegments, firstInByDay });
  }

  const out = new Map<string, UserScore>();
  const ensure = (uid: string): UserScore => {
    let s = out.get(uid);
    if (!s) {
      s = emptyScore();
      out.set(uid, s);
    }
    return s;
  };

  // Seed every user who has work in the period — even if no scheduled
  // shift survived the location filter — so they still show up on the
  // table with their hours.
  for (const [uid, data] of segmentsByUser) {
    ensure(uid).totalWorkMs = data.workMs;
  }

  for (const sh of filteredShifts) {
    const score = ensure(sh.userId);
    score.scheduled += 1;
    const data = segmentsByUser.get(sh.userId);
    const k = dayKey(sh.startsAt);
    const workedThatDay = (data?.workMsByDay.get(k) ?? 0) > 0;
    if (workedThatDay) {
      score.attended += 1;
    } else {
      score.noShows += 1;
    }

    // Lateness — compare first `in` of that calendar day against scheduled start.
    const firstIn = data?.firstInByDay.get(k);
    if (firstIn) {
      const diff = firstIn.getTime() - sh.startsAt.getTime();
      if (diff > LATE_GRACE_MS) {
        score.lateCount += 1;
        score.lateMs += diff;
      }
    }

    // Unapproved OT — sum of work-segment overlap *beyond* shift.endsAt + grace,
    // counted only when the covering week has no approved timesheet row.
    // Cap the OT window at the next shift's start to avoid attributing
    // work done before tomorrow's shift to today's OT.
    const wk = weekKey(sh.startsAt);
    const approved = approvedWeeks.has(`${sh.userId}|${wk}`);
    if (!approved && data) {
      const otStart = sh.endsAt.getTime() + OT_GRACE_MS;
      // Find the next shift start strictly after this shift's start. The
      // shifts array isn't pre-sorted; scan linearly — typical periods
      // hold tens of shifts per user, not thousands.
      let nextStart = Number.POSITIVE_INFINITY;
      for (const other of filteredShifts) {
        if (other.userId !== sh.userId) continue;
        const t = other.startsAt.getTime();
        if (t > sh.startsAt.getTime() && t < nextStart) nextStart = t;
      }
      for (const seg of data.workSegments) {
        const segEnd = seg.endedAt.getTime();
        if (segEnd <= otStart) continue;
        const segStart = Math.max(seg.startedAt.getTime(), otStart);
        const overlap = Math.min(segEnd, nextStart) - segStart;
        if (overlap > 0) score.unapprovedOtMs += overlap;
      }
    }
  }

  return out;
}
