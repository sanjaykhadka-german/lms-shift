import type { AwardPreset } from "../presets";

// Meat Industry Award 2020 [MA000059].
//
// ⚠️ SEEDED RULE STRUCTURE — VERIFY before relying on for pay.
//
// This file carries only the award's HOURS + PENALTY *structure* (the rules
// that change rarely), each cited to the instrument. It deliberately does NOT
// carry dollar figures — classification minimum rates and allowance amounts
// come from the Fair Work Commission MAPD pull (Slice D), which stamps the
// authoritative `effectiveFrom`. Every value below is a starting point to be
// confirmed against the current award text + the Fair Work Pay Guide; the
// annual wage review changes figures each 1 July.
//
// Sources to confirm (clause numbers approximate — verify in the current MA000059):
//   - Ordinary hours / 38-hour week .......... cl. 16 Ordinary hours of work
//   - Overtime (first 2h 150%, then 200%) .... cl. 28 Overtime
//   - Saturday / Sunday / public holiday ..... cl. 27 Penalty rates
//   - Casual loading 25% ..................... cl. 11 Casual employees
export const MA000059: AwardPreset = {
  code: "MA000059",
  name: "Meat Industry Award 2020",
  // FLAG: set to the rule-set you actually verify / the FWC effective date.
  effectiveFrom: "2024-07-01",
  // cl. 11 — casual loading 25%. Used by the classification floor (Slice B)
  // to compute the casual minimum (base × 1.25). VERIFY.
  casualLoading: 0.25,
  profile: {
    // cl. 16 — 38 ordinary hours/week. OT here is purely a function of the
    // 38-hour week (not daily length): ordinary up to 38h, then the first
    // 3h of weekly OT at 150%, thereafter 200%. This matches how German
    // Butchery runs the award (the daily 8h/10h numbers are retained only
    // as a fallback for the "daily" basis and are unused while basis is
    // "weekly"). VERIFY the first-tier hours against the current instrument.
    thresholds: {
      dailyOrdinaryMinutes: 8 * 60, // unused under weekly basis; VERIFY
      dailyOvertimeMinutes: 10 * 60, // unused under weekly basis; VERIFY
      weeklyOrdinaryMinutes: 38 * 60, // cl. 16
      overtimeBasis: "weekly",
      weeklyOvertimeFirstTierMinutes: 3 * 60, // first 3h OT @150%; VERIFY
    },
    // cl. 28 — overtime: first tier 150%, thereafter 200%.
    overtimeMultiplier: 1.5,
    doubleOvertimeMultiplier: 2.0,
    // cl. 27 — penalty rates. VERIFY each against the current instrument; the
    // FWC pull (Slice D) overwrites these with the authoritative figures.
    penaltyMultipliers: {
      weekday: 1.0,
      saturday: 1.5, // FLAG VERIFY
      sunday: 2.0, // FLAG VERIFY
      public_holiday: 2.5, // FLAG VERIFY
    },
    // Non-stacking baseline (penalty OR overtime, whichever is greater).
    costPolicy: "max",
  },
};
