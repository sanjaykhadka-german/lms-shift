// Pure helpers for category → Xero line-item conversion.
// AUDIT.md #5. Kept separate from xero.ts so the unit tests can
// exercise the math without a Xero client.

import type { WeekBreakdown } from "@tracey/award";
import type { ScPayrollCategory } from "@tracey/db";

export const PAYROLL_CATEGORIES: ScPayrollCategory[] = [
  "ordinary",
  "overtime",
  "penalty_sat",
  "penalty_sun",
  "penalty_ph",
  "penalty_night",
  "allowance",
];

// Friendly labels for the mapping admin UI. The slug is the wire
// value; the label is what humans see.
export const PAYROLL_CATEGORY_LABEL: Record<ScPayrollCategory, string> = {
  ordinary: "Ordinary hours",
  overtime: "Overtime hours",
  penalty_sat: "Saturday penalty",
  penalty_sun: "Sunday penalty",
  penalty_ph: "Public holiday penalty",
  penalty_night: "Night-shift penalty",
  allowance: "Allowances",
};

// Convert classifier minutes into 2-decimal hours for Xero's
// numberOfUnits field. Xero treats the unit per the earnings rate's
// configured type (typically "Hours"); zero stays zero.
function minutesToHours(m: number): number {
  if (!Number.isFinite(m) || m <= 0) return 0;
  return Math.round((m / 60) * 100) / 100;
}

// Given a WeekBreakdown from @tracey/award (the classifier output)
// for one employee's week, produce a Map<ScPayrollCategory, 7-day
// hours array>. Zero-only categories are dropped so we don't push
// empty lines to Xero.
//
// v1 semantics (documented for the admin):
//   - On a weekday: ordinaryMinutes → "ordinary", overtimeMinutes +
//     doubleOvertimeMinutes → "overtime" (Xero handles the 1.5x vs
//     2x split via separate earnings rates if the admin mapped one).
//   - On a saturday / sunday / public_holiday: ALL worked minutes
//     (including OT) flow to that penalty category. The Xero
//     earnings rate the admin maps it to is expected to already
//     carry the penalty multiplier.
//
// Overtime-on-a-penalty-day at a different rate is an explicit v2
// follow-up — needs the classifier to emit a separate
// "penalty + overtime" combo, which it doesn't yet.

export function buildCategoryUnitsFromBreakdown(
  breakdown: WeekBreakdown,
): Map<ScPayrollCategory, number[]> {
  const out = new Map<ScPayrollCategory, number[]>();

  const ensure = (cat: ScPayrollCategory): number[] => {
    let arr = out.get(cat);
    if (!arr) {
      arr = [0, 0, 0, 0, 0, 0, 0];
      out.set(cat, arr);
    }
    return arr;
  };

  for (let dayIdx = 0; dayIdx < breakdown.days.length && dayIdx < 7; dayIdx += 1) {
    const day = breakdown.days[dayIdx]!;
    if (day.workedMinutes <= 0) continue;

    const totalMinutes =
      day.ordinaryMinutes + day.overtimeMinutes + day.doubleOvertimeMinutes;
    if (totalMinutes <= 0) continue;

    if (day.penaltyCategory === "weekday") {
      const ord = minutesToHours(day.ordinaryMinutes);
      const ot = minutesToHours(
        day.overtimeMinutes + day.doubleOvertimeMinutes,
      );
      if (ord > 0) ensure("ordinary")[dayIdx] = ord;
      if (ot > 0) ensure("overtime")[dayIdx] = ot;
    } else {
      // Penalty day — all worked minutes flow into the penalty bucket.
      const bucket = mapPenaltyCategory(day.penaltyCategory);
      if (bucket) {
        const total = minutesToHours(totalMinutes);
        if (total > 0) ensure(bucket)[dayIdx] = total;
      }
    }
  }

  return out;
}

// Map the classifier's PenaltyCategory enum to our ScPayrollCategory.
// "weekday" is handled separately above; that branch isn't reached.
function mapPenaltyCategory(category: string): ScPayrollCategory | null {
  switch (category) {
    case "saturday":
      return "penalty_sat";
    case "sunday":
      return "penalty_sun";
    case "public_holiday":
      return "penalty_ph";
    default:
      return null;
  }
}

// Validates an earnings-mapping covers every category the week's
// breakdown actually uses. Returns the list of missing categories
// (in display order) or an empty array if all are mapped.

export function findMissingMappings(
  used: Iterable<ScPayrollCategory>,
  mapping: Map<ScPayrollCategory, string>,
): ScPayrollCategory[] {
  const missing: ScPayrollCategory[] = [];
  const seen = new Set<ScPayrollCategory>();
  for (const cat of used) {
    if (seen.has(cat)) continue;
    seen.add(cat);
    if (!mapping.has(cat)) missing.push(cat);
  }
  // Stable display order matches the master list.
  missing.sort(
    (a, b) =>
      PAYROLL_CATEGORIES.indexOf(a) - PAYROLL_CATEGORIES.indexOf(b),
  );
  return missing;
}
