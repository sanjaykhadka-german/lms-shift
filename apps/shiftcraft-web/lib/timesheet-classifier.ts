// AUDIT.md Phase 2 #3b.3 — wire the @tracey/award classifier into the
// existing /app/timesheets surface.
//
// The page already computes a `perDay: number[7]` of worked-ms per user
// per week. This helper converts that into the `@tracey/award` input
// shape, calls `classifyWeek`, and pre-formats display strings so the
// row component stays free of math + server-only imports.

import {
  classifyWeek,
  DEFAULT_PENALTY_MULTIPLIERS,
  type DayBreakdown,
  type DayInput,
  type PenaltyCategory,
  type PenaltyMultipliers,
  type WeekBreakdown,
} from "@tracey/award";
import { addDays, fmtHours, fmtIsoDate } from "./clock";

// Zip a 7-element per-day ms array with the week's start date into
// `DayInput[]` keyed by ISO date. Index 0 = Monday-of-week (matches
// `startOfWeek` semantics already used by /app/timesheets).
export function buildDayInputs(
  weekStart: Date,
  perDayMs: number[],
): DayInput[] {
  return perDayMs.map((ms, i) => ({
    date: fmtIsoDate(addDays(weekStart, i)),
    workedMinutes: Math.round(ms / 60_000),
  }));
}

// Run the classifier for one employee's week. Pure pass-through — the
// caller resolves holidays once for the whole page and passes the set
// here per row.
export function classifyEmployeeWeek(
  weekStart: Date,
  perDayMs: number[],
  holidayDates: ReadonlySet<string>,
): WeekBreakdown {
  return classifyWeek(buildDayInputs(weekStart, perDayMs), {
    holidayDates,
  });
}

// Format "28h ordinary · 2h OT 1.5× · 1h OT 2×". The OT and double-OT
// chips drop out when zero so a clean week reads simply as "38h ord".
// Returns null when the row has no worked minutes (the row component
// already shows "—" in that case).
export function fmtBreakdown(breakdown: WeekBreakdown): string | null {
  const { ordinaryMinutes, overtimeMinutes, doubleOvertimeMinutes } =
    breakdown.totals;
  if (
    ordinaryMinutes + overtimeMinutes + doubleOvertimeMinutes === 0
  ) {
    return null;
  }
  const parts: string[] = [];
  if (ordinaryMinutes > 0) {
    parts.push(`${fmtHours(ordinaryMinutes * 60_000)} ord`);
  }
  if (overtimeMinutes > 0) {
    parts.push(`${fmtHours(overtimeMinutes * 60_000)} OT 1.5×`);
  }
  if (doubleOvertimeMinutes > 0) {
    parts.push(`${fmtHours(doubleOvertimeMinutes * 60_000)} OT 2×`);
  }
  return parts.join(" · ");
}

// Count of days tagged `public_holiday` in this week. Used by the row
// component to show a small "public holiday" chip warning the manager
// that penalty rates may apply (cost computation is a future slice).
export function countPublicHolidays(breakdown: WeekBreakdown): number {
  let n = 0;
  for (const d of breakdown.days) {
    if (d.penaltyCategory === "public_holiday") n += 1;
  }
  return n;
}

// Highest-penalty category present in the week, in {public_holiday,
// sunday, saturday, weekday}. Drives a single-chip summary in the row.
export function highestPenaltyCategory(
  breakdown: WeekBreakdown,
): PenaltyCategory {
  const cats = new Set(breakdown.days.map((d) => d.penaltyCategory));
  if (cats.has("public_holiday")) return "public_holiday";
  if (cats.has("sunday")) return "sunday";
  if (cats.has("saturday")) return "saturday";
  return "weekday";
}

// ─── Award-derived cost (Phase 2 #3b.4) ──────────────────────────────
//
// Translates a WeekBreakdown + hourly rate into a $ amount using two
// possible policies:
//   - "max"   : for each band, multiplier = max(penalty, OT). Common in
//               awards that treat penalty and overtime as alternatives,
//               not stackable. Safe AU baseline.
//   - "stack" : for each band, multiplier = penalty × OT. Common in
//               awards (e.g. General Retail) where Sunday + OT stack
//               into 2.25× / 3× / etc.
// Tenants will be able to set this per their applicable award in a
// later sc_tenant_config slice. Default here is "max".
//
// Returns a DayCostBreakdown[] (so UI tooltips can explain which
// multiplier was applied per day) plus the week total.

export type CostPolicy = "max" | "stack";

export interface CostOptions {
  policy?: CostPolicy;
  penaltyMultipliers?: PenaltyMultipliers;
  overtimeMultiplier?: number;
  doubleOvertimeMultiplier?: number;
}

export interface DayCost {
  date: string;
  penaltyCategory: PenaltyCategory;
  /** Effective $ amount paid for ordinary minutes on this day. */
  ordinaryCost: number;
  /** Effective $ amount paid for OT 1.5× minutes. */
  overtimeCost: number;
  /** Effective $ amount paid for OT 2× minutes. */
  doubleOvertimeCost: number;
  totalCost: number;
}

export interface WeekCost {
  policy: CostPolicy;
  perDay: DayCost[];
  totalCost: number;
}

const DEFAULT_OT_MULTIPLIER = 1.5;
const DEFAULT_DOUBLE_OT_MULTIPLIER = 2.0;

function bandMultiplier(
  penalty: number,
  ot: number,
  policy: CostPolicy,
): number {
  return policy === "stack" ? penalty * ot : Math.max(penalty, ot);
}

function dayCost(
  d: DayBreakdown,
  ratePerMinute: number,
  penaltyMultipliers: PenaltyMultipliers,
  otMult: number,
  dotMult: number,
  policy: CostPolicy,
): DayCost {
  const pMult = penaltyMultipliers[d.penaltyCategory];
  const ordinaryCost = d.ordinaryMinutes * ratePerMinute * pMult;
  const overtimeCost =
    d.overtimeMinutes * ratePerMinute * bandMultiplier(pMult, otMult, policy);
  const doubleOvertimeCost =
    d.doubleOvertimeMinutes *
    ratePerMinute *
    bandMultiplier(pMult, dotMult, policy);
  return {
    date: d.date,
    penaltyCategory: d.penaltyCategory,
    ordinaryCost,
    overtimeCost,
    doubleOvertimeCost,
    totalCost: ordinaryCost + overtimeCost + doubleOvertimeCost,
  };
}

// Pure: same inputs → same output. Cost is in the SAME unit as the
// hourly rate (no currency conversion). Callers round at the display
// boundary.
export function computeAwardCost(
  breakdown: WeekBreakdown,
  hourlyRate: number,
  opts: CostOptions = {},
): WeekCost {
  const policy = opts.policy ?? "max";
  const penaltyMultipliers =
    opts.penaltyMultipliers ?? DEFAULT_PENALTY_MULTIPLIERS;
  const otMult = opts.overtimeMultiplier ?? DEFAULT_OT_MULTIPLIER;
  const dotMult = opts.doubleOvertimeMultiplier ?? DEFAULT_DOUBLE_OT_MULTIPLIER;
  const ratePerMinute = hourlyRate / 60;

  const perDay = breakdown.days.map((d) =>
    dayCost(d, ratePerMinute, penaltyMultipliers, otMult, dotMult, policy),
  );
  const totalCost = perDay.reduce((sum, d) => sum + d.totalCost, 0);
  return { policy, perDay, totalCost };
}

// Round to whole cents at the display boundary so the UI never shows
// 304.0000000000001 floating-point artefacts.
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
