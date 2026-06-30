// Pure helpers for category → Xero line-item conversion.
// AUDIT.md #5. Kept separate from xero.ts so the unit tests can
// exercise the math without a Xero client.

import type { WeekBreakdown } from "@tracey/award";
import type { ScPayrollCategory } from "@tracey/db";

export const PAYROLL_CATEGORIES: ScPayrollCategory[] = [
  "ordinary",
  "overtime",
  "overtime_double",
  "penalty_sat",
  "penalty_sat_ot",
  "penalty_sun",
  "penalty_sun_ot",
  "penalty_ph",
  "penalty_ph_ot",
  "penalty_night",
  "allowance",
];

// Friendly labels for the mapping admin UI. The slug is the wire
// value; the label is what humans see. The *_ot rows are the opt-in
// "overtime worked on a penalty day" combo categories — leave them
// unmapped to keep the legacy behaviour (OT folds into the base
// penalty bucket).
export const PAYROLL_CATEGORY_LABEL: Record<ScPayrollCategory, string> = {
  ordinary: "Ordinary hours",
  overtime: "Overtime hours",
  overtime_double: "Overtime (double time)",
  penalty_sat: "Saturday penalty",
  penalty_sat_ot: "Saturday overtime",
  penalty_sun: "Sunday penalty",
  penalty_sun_ot: "Sunday overtime",
  penalty_ph: "Public holiday penalty",
  penalty_ph_ot: "Public holiday overtime",
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
// Semantics (documented for the admin):
//   - On a weekday: ordinaryMinutes → "ordinary", overtimeMinutes +
//     doubleOvertimeMinutes → "overtime" (Xero handles the 1.5x vs
//     2x split via separate earnings rates if the admin mapped one).
//   - On a saturday / sunday / public_holiday:
//       · ordinary minutes → that penalty category (penalty_sat/sun/ph).
//       · overtime minutes → the matching *_ot combo category
//         (penalty_sat_ot/sun_ot/ph_ot) — BUT ONLY when the tenant has
//         mapped that combo to a Xero earnings rate (passed in via
//         `mappedCategories`). If the combo is unmapped, the OT folds
//         back into the base penalty bucket so the export behaves
//         exactly as it did before these categories existed (no
//         regression, no surprise "missing mapping" errors).
//
// `mappedCategories` is the set of categories the tenant has an earnings
// mapping for. Omit it (or pass an empty set) for the legacy "everything
// into the base penalty bucket" behaviour.

export function buildCategoryUnitsFromBreakdown(
  breakdown: WeekBreakdown,
  mappedCategories?: ReadonlySet<ScPayrollCategory>,
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

    const otMinutes = day.overtimeMinutes + day.doubleOvertimeMinutes;
    const totalMinutes = day.ordinaryMinutes + otMinutes;
    if (totalMinutes <= 0) continue;

    if (day.penaltyCategory === "weekday") {
      const ord = minutesToHours(day.ordinaryMinutes);
      if (ord > 0) ensure("ordinary")[dayIdx] = ord;
      // Split the 2x band onto its own "overtime_double" line ONLY when the
      // tenant has mapped it to a distinct Xero rate (e.g. "OT thereafter").
      // Otherwise both OT bands fold into "overtime" — the pre-existing
      // behaviour, so adding this category never changes an unmapped export.
      const splitDouble =
        day.doubleOvertimeMinutes > 0 &&
        (mappedCategories?.has("overtime_double") ?? false);
      if (splitDouble) {
        const ot = minutesToHours(day.overtimeMinutes);
        const otd = minutesToHours(day.doubleOvertimeMinutes);
        if (ot > 0) ensure("overtime")[dayIdx] = ot;
        if (otd > 0) ensure("overtime_double")[dayIdx] = otd;
      } else {
        const ot = minutesToHours(otMinutes);
        if (ot > 0) ensure("overtime")[dayIdx] = ot;
      }
    } else {
      const bucket = mapPenaltyCategory(day.penaltyCategory);
      if (!bucket) continue;
      const otBucket = mapPenaltyOtCategory(day.penaltyCategory);
      const splitOt =
        otMinutes > 0 &&
        otBucket != null &&
        (mappedCategories?.has(otBucket) ?? false);

      if (splitOt) {
        // Ordinary → base penalty bucket; OT → the combo bucket.
        const ord = minutesToHours(day.ordinaryMinutes);
        const ot = minutesToHours(otMinutes);
        if (ord > 0) ensure(bucket)[dayIdx] = ord;
        if (ot > 0) ensure(otBucket)[dayIdx] = ot;
      } else {
        // Legacy fold: all worked minutes into the base penalty bucket.
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

// The opt-in "overtime on a penalty day" combo for each penalty
// category. Returns null for weekday (handled separately).
function mapPenaltyOtCategory(category: string): ScPayrollCategory | null {
  switch (category) {
    case "saturday":
      return "penalty_sat_ot";
    case "sunday":
      return "penalty_sun_ot";
    case "public_holiday":
      return "penalty_ph_ot";
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
