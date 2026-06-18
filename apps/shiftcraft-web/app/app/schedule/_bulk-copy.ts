// Pure helpers for the schedule "bulk copy" flow (multi-select → copy to a
// day / week / department). Kept out of actions.ts because that file is
// "use server" and may only export async functions; this module is plain and
// is imported by both the server action and its unit test.

/** Where the selected shifts should be copied to. */
export type BulkCopyTarget =
  // Copy every selected shift onto this calendar date, same time-of-day.
  | { kind: "date"; date: string } // YYYY-MM-DD
  // Copy onto the same weekday within the chosen week (Mon-start).
  | { kind: "week"; weekStart: string } // YYYY-MM-DD (Mon of target week)
  // Shortcut: +7 days each.
  | { kind: "nextWeek" }
  // Same dates/times, reassigned to another area (location + role/name).
  | { kind: "area"; locationId: string; role: string };

export interface BulkCopySource {
  startsAt: Date;
  endsAt: Date;
  locationId: string | null;
  role: string;
}

export interface BulkCopyResolved {
  startsAt: Date;
  endsAt: Date;
  locationId: string | null;
  role: string;
}

const DAY_MS = 86_400_000;

/** Whole-day difference between two dates, compared by their local Y/M/D.
 *  Mirrors copyDayToDateAction's Date.UTC-based delta so a copy lands on the
 *  intended calendar date regardless of the times' offsets. */
function wholeDayDelta(from: Date, to: Date): number {
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      DAY_MS,
  );
}

/** Parse a YYYY-MM-DD string at local midnight (null when malformed). */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Resolve a copied shift's new times + area for the given bulk-copy target.
 * Times are offset by a whole-day count (preserving time-of-day the same way
 * copyDayToDateAction does). Returns null when the inputs are invalid (e.g. a
 * malformed date string) so the caller can skip that shift.
 *
 * `weekStartMsOfSource` is the start-of-week (local Mon midnight) for the
 * source shift, used only by the "week" target to keep the weekday offset.
 */
export function resolveBulkCopyTarget(
  src: BulkCopySource,
  target: BulkCopyTarget,
  weekStartMsOfSource: number,
): BulkCopyResolved | null {
  switch (target.kind) {
    case "area":
      return {
        startsAt: new Date(src.startsAt.getTime()),
        endsAt: new Date(src.endsAt.getTime()),
        locationId: target.locationId,
        role: target.role,
      };
    case "nextWeek":
      return shiftByDays(src, 7);
    case "date": {
      const targetDate = parseLocalDate(target.date);
      if (!targetDate) return null;
      const delta = wholeDayDelta(src.startsAt, targetDate);
      return shiftByDays(src, delta);
    }
    case "week": {
      const targetWeekStart = parseLocalDate(target.weekStart);
      if (!targetWeekStart) return null;
      // The weekday offset (src day within its week) cancels out, so the delta
      // is simply the gap between the source week-start and the target one.
      const delta = wholeDayDelta(new Date(weekStartMsOfSource), targetWeekStart);
      return shiftByDays(src, delta);
    }
  }
}

function shiftByDays(src: BulkCopySource, deltaDays: number): BulkCopyResolved {
  const offset = deltaDays * DAY_MS;
  return {
    startsAt: new Date(src.startsAt.getTime() + offset),
    endsAt: new Date(src.endsAt.getTime() + offset),
    locationId: src.locationId,
    role: src.role,
  };
}
