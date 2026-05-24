// @tracey/award — AU Modern Award rate interpreter (AUDIT.md Phase 2 #3b).
//
// Pure functions. No DB, no Next.js, no I/O. The package takes a week of
// per-day worked totals and classifies the minutes into pay categories
// {ordinary, overtime 1.5x, overtime 2x}. Penalty rates (weekend,
// evening, public holiday) ship in the next sub-slice (3b.2). Cost
// computation (rate × minutes × multiplier) is intentionally out of
// scope here — that's a thin wrapper a consumer can build, but keeping
// the classifier pure-numerical means tenant rates / currency /
// rounding don't leak into the rules engine.
//
// Default thresholds approximate the Fair Work Modern Award "general
// rule" baseline. They're configurable per call (and ultimately per
// tenant, when sc_tenant_config grows an award_profile column in a
// later slice).

export const DEFAULT_THRESHOLDS: AwardThresholds = {
  // 8h ordinary per day. Some awards say 7.6h; tenants override if so.
  dailyOrdinaryMinutes: 8 * 60,
  // 8-10h = OT 1.5x. Past 10h = OT 2x.
  dailyOvertimeMinutes: 10 * 60,
  // 38h ordinary per week. Anything beyond cascades to OT 1.5x even if
  // a single day didn't itself trigger a daily OT band.
  weeklyOrdinaryMinutes: 38 * 60,
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

export interface DayInput {
  /** ISO YYYY-MM-DD. Used only for ordering + traceability — the
   *  classifier does NOT itself look up day-of-week (weekend penalty
   *  belongs to the penalty-rates slice, not here). */
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

/**
 * Classify a week of per-day worked totals into ordinary / OT 1.5x / OT 2x.
 *
 * Algorithm:
 *   1. Day-pass: each day's `workedMinutes` is partitioned by the daily
 *      thresholds into three bands.
 *   2. Week-pass: walk days chronologically, accumulating ordinary
 *      minutes. The moment cumulative ordinary exceeds the weekly cap,
 *      pull the surplus from THIS day's ordinary and push it into OT
 *      1.5x. The double-OT band is untouched by the weekly cap (it
 *      represents work already past the daily 10h boundary).
 *
 * The function is pure: same inputs → same outputs. No DB, no clock.
 */
export function classifyWeek(
  days: DayInput[],
  thresholdsOverride: Partial<AwardThresholds> = {},
): WeekBreakdown {
  const thresholds: AwardThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...thresholdsOverride,
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
