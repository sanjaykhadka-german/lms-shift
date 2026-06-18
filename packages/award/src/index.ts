// @tracey/award — AU Modern Award rate interpreter (AUDIT.md Phase 2 #3b).
//
// Pure functions. No DB, no Next.js, no I/O. The package takes a week of
// per-day worked totals and:
//   1. classifies the minutes into pay BANDS {ordinary, OT 1.5x, OT 2x}
//      via daily + weekly thresholds (3b.1)
//   2. tags each day with a penalty CATEGORY {weekday, saturday, sunday,
//      public_holiday} so a consumer can apply the right multiplier
//      (3b.2 — this slice).
//
// What's still out of scope here:
//   - Time-of-day evening / late-night penalty windows (sub-day segment
//     splitting needed — separate slice).
//   - Cost computation (rate × minutes × band × penalty). The classifier
//     deliberately stops at numerical/categorical output so tenant rates,
//     currency, and rounding don't leak into the rules engine.
//   - Combining penalty × OT — different awards stack vs take-the-max.
//     The consumer picks the policy with these inputs.
//
// Default thresholds + penalty multipliers approximate the Fair Work
// Modern Award "general rule" baseline. They're configurable per call
// (and ultimately per tenant, when sc_tenant_config grows an
// award_profile column in a later slice).

export const DEFAULT_THRESHOLDS: AwardThresholds = {
  // 8h ordinary per day. Some awards say 7.6h; tenants override if so.
  dailyOrdinaryMinutes: 8 * 60,
  // 8-10h = OT 1.5x. Past 10h = OT 2x.
  dailyOvertimeMinutes: 10 * 60,
  // 38h ordinary per week. Anything beyond cascades to OT 1.5x even if
  // a single day didn't itself trigger a daily OT band.
  weeklyOrdinaryMinutes: 38 * 60,
};

// General-rule penalty multipliers. Specific awards vary widely; these
// are the most common AU defaults and a starting point for tenant
// overrides. Public-holiday rate eclipses weekend (a holiday on a
// Saturday is paid at 2.5x, not 1.25x).
export const DEFAULT_PENALTY_MULTIPLIERS: PenaltyMultipliers = {
  weekday: 1.0,
  saturday: 1.25,
  sunday: 1.5,
  public_holiday: 2.5,
};

export interface AwardThresholds {
  /** Minutes of ordinary time allowed per day before the OT 1.5x band starts. */
  dailyOrdinaryMinutes: number;
  /** Minutes of total time per day at which the OT 2.0x band begins.
   *  Must be ≥ dailyOrdinaryMinutes. The OT 1.5x band fills the gap. */
  dailyOvertimeMinutes: number;
  /** Cap on cumulative weekly ordinary minutes. Excess cascades to OT 1.5x. */
  weeklyOrdinaryMinutes: number;
}

export type PenaltyCategory =
  | "weekday"
  | "saturday"
  | "sunday"
  | "public_holiday";

export type PenaltyMultipliers = Record<PenaltyCategory, number>;

export interface DayInput {
  /** ISO YYYY-MM-DD. Used to derive both ordering and day-of-week +
   *  public-holiday lookup. Parsed as a calendar date (UTC) — no
   *  timezone shifts, no DST drift. */
  date: string;
  /** Total minutes worked that day, *excluding* unpaid breaks. Callers
   *  derive this from the clock-event stream (see lib/clock.ts) and
   *  hand the integer in. Negative inputs are clamped to 0. */
  workedMinutes: number;
}

export interface DayBreakdown {
  date: string;
  workedMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  doubleOvertimeMinutes: number;
  /** Penalty category derived from date + the optional holiday set. */
  penaltyCategory: PenaltyCategory;
}

export interface WeekTotals {
  workedMinutes: number;
  ordinaryMinutes: number;
  overtimeMinutes: number;
  doubleOvertimeMinutes: number;
}

export interface WeekBreakdown {
  /** Day rows in ASC date order (regardless of input order). */
  days: DayBreakdown[];
  totals: WeekTotals;
  /** Echo of the thresholds actually used. Handy for UIs that want to
   *  surface "Why is this row 6h ordinary + 3h OT?" tooltips. */
  thresholds: AwardThresholds;
}

export interface ClassifyWeekOptions {
  thresholds?: Partial<AwardThresholds>;
  /** Optional set of ISO YYYY-MM-DD dates the consumer considers public
   *  holidays for the worker's tenant region. Days whose date is in
   *  this set are tagged `public_holiday`, overriding weekend status. */
  holidayDates?: ReadonlySet<string>;
}

/**
 * Decide the penalty category for a single date. Public-holiday status
 * (when the date is in `holidayDates`) takes precedence over weekend.
 *
 * Pure: same inputs → same output. No `new Date()` of the system clock,
 * only `Date.UTC` of the parsed parts — so this is deterministic across
 * server timezones.
 */
export function getPenaltyCategory(
  dateISO: string,
  holidayDates?: ReadonlySet<string>,
): PenaltyCategory {
  if (holidayDates?.has(dateISO)) return "public_holiday";
  const parts = dateISO.split("-").map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`getPenaltyCategory: invalid date "${dateISO}"`);
  }
  const [y, m, d] = parts as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0) return "sunday";
  if (dow === 6) return "saturday";
  return "weekday";
}

/**
 * Classify a week of per-day worked totals into ordinary / OT 1.5x /
 * OT 2x, and tag each day with its penalty category.
 *
 * Algorithm:
 *   1. Day-pass: each day's `workedMinutes` is partitioned by the daily
 *      thresholds into three bands.
 *   2. Week-pass: walk days chronologically, accumulating ordinary
 *      minutes. The moment cumulative ordinary exceeds the weekly cap,
 *      pull the surplus from THIS day's ordinary and push it into OT
 *      1.5x. The double-OT band is untouched by the weekly cap (it
 *      represents work already past the daily 10h boundary).
 *   3. Penalty-tag pass: each day gets `penaltyCategory`. Public
 *      holiday wins over weekend.
 *
 * The function is pure: same inputs → same outputs. No DB, no clock.
 */
export function classifyWeek(
  days: DayInput[],
  options: ClassifyWeekOptions = {},
): WeekBreakdown {
  const thresholds: AwardThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };
  if (thresholds.dailyOvertimeMinutes < thresholds.dailyOrdinaryMinutes) {
    throw new Error(
      "AwardThresholds: dailyOvertimeMinutes must be >= dailyOrdinaryMinutes",
    );
  }

  // Day-pass.
  const dayBreakdowns: DayBreakdown[] = days.map((d) => {
    const worked = Math.max(0, d.workedMinutes);
    const ordinary = Math.min(worked, thresholds.dailyOrdinaryMinutes);
    const ot15Cap =
      thresholds.dailyOvertimeMinutes - thresholds.dailyOrdinaryMinutes;
    const overtime = Math.min(
      Math.max(0, worked - thresholds.dailyOrdinaryMinutes),
      ot15Cap,
    );
    const doubleOvertime = Math.max(
      0,
      worked - thresholds.dailyOvertimeMinutes,
    );
    return {
      date: d.date,
      workedMinutes: worked,
      ordinaryMinutes: ordinary,
      overtimeMinutes: overtime,
      doubleOvertimeMinutes: doubleOvertime,
      penaltyCategory: getPenaltyCategory(d.date, options.holidayDates),
    };
  });

  // Sort chronologically so the week-pass cascades onto the *latest*
  // days when ordinary spills over — that matches how managers normally
  // think about it ("the last day pushed me into OT").
  dayBreakdowns.sort((a, b) => a.date.localeCompare(b.date));

  // Week-pass.
  let cumulativeOrdinary = 0;
  for (const d of dayBreakdowns) {
    cumulativeOrdinary += d.ordinaryMinutes;
    if (cumulativeOrdinary > thresholds.weeklyOrdinaryMinutes) {
      const excess = cumulativeOrdinary - thresholds.weeklyOrdinaryMinutes;
      d.ordinaryMinutes -= excess;
      d.overtimeMinutes += excess;
      cumulativeOrdinary = thresholds.weeklyOrdinaryMinutes;
    }
  }

  const totals = dayBreakdowns.reduce<WeekTotals>(
    (acc, d) => ({
      workedMinutes: acc.workedMinutes + d.workedMinutes,
      ordinaryMinutes: acc.ordinaryMinutes + d.ordinaryMinutes,
      overtimeMinutes: acc.overtimeMinutes + d.overtimeMinutes,
      doubleOvertimeMinutes:
        acc.doubleOvertimeMinutes + d.doubleOvertimeMinutes,
    }),
    {
      workedMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      doubleOvertimeMinutes: 0,
    },
  );

  return { days: dayBreakdowns, totals, thresholds };
}

// Award preset catalogue (named Modern Awards → rule structure).
export * from "./presets";

// Minimum-rate floor check against an award classification.
export * from "./floor";

// Allowance computation (emits the `allowance` payroll category).
export * from "./allowances";
