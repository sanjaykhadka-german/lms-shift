// AUDIT.md Phase 2 #3b.3 — wire the @tracey/award classifier into the
// existing /app/timesheets surface.
//
// The page already computes a `perDay: number[7]` of worked-ms per user
// per week. This helper converts that into the `@tracey/award` input
// shape, calls `classifyWeek`, and pre-formats display strings so the
// row component stays free of math + server-only imports.

import {
  classifyWeek,
  type DayInput,
  type PenaltyCategory,
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
