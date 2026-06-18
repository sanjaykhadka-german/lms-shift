// Award preset catalogue (AUDIT.md Feature 4 — Fair Work integration).
//
// A preset maps a Modern Award code to the @tracey/award rule structure
// (thresholds + multipliers) plus light metadata. The `profile` shape is
// structurally identical to the app's `AwardProfileOverrides`, so a consumer
// can stamp `preset.profile` straight into sc_tenant_config.award_profile.
//
// Keep the actual numbers in the per-award data files (./data/*) so adding a
// new award is a data exercise, not new code. Dollar rates (classification
// minimums, allowance amounts) live in the DB, populated by the FWC pull —
// never here.
import type { AwardThresholds, PenaltyMultipliers } from "./index";

export interface AwardProfile {
  thresholds?: Partial<AwardThresholds>;
  overtimeMultiplier?: number;
  doubleOvertimeMultiplier?: number;
  penaltyMultipliers?: Partial<PenaltyMultipliers>;
  /** "max" (penalty OR OT) | "stack" (penalty × OT). */
  costPolicy?: "max" | "stack";
}

export interface AwardPreset {
  /** Modern Award code, e.g. "MA000059". */
  code: string;
  /** Human-readable award name. */
  name: string;
  /** ISO date the embedded rule-set took effect (preset version stamp). */
  effectiveFrom: string;
  /** Casual loading as a fraction (0.25 = 25%); informational for the
   *  classification floor (Slice B). Not part of the award profile. */
  casualLoading?: number;
  profile: AwardProfile;
}

import { MA000059 } from "./data/ma000059";

export { MA000059 };

export const AWARD_PRESETS: Record<string, AwardPreset> = {
  [MA000059.code]: MA000059,
};

export function getAwardPreset(code: string): AwardPreset | undefined {
  return AWARD_PRESETS[code];
}

/** Codes + names for an award picker, sorted by name. */
export function listAwardPresets(): Array<{ code: string; name: string }> {
  return Object.values(AWARD_PRESETS)
    .map((p) => ({ code: p.code, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
