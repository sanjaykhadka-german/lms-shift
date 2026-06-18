// Minimum-rate floor check (AUDIT.md Feature 4 — Fair Work, Slice B).
//
// Pure: compares an employee's hourly rate against their award classification
// minimum. Casuals are held to base × (1 + casual loading). No DB, no IO — the
// caller resolves the classification row and passes the numbers in, so this is
// reusable from the admin UI, the timesheet cost view, and (later) the Xero
// export approval gate.

export interface RateFloorInput {
  /** The employee's stored hourly rate. Null = not set. */
  hourlyRate: number | null;
  /** The classification's permanent (non-casual) minimum hourly rate. */
  baseHourlyRate: number;
  /** Casual loading as a fraction (0.25 = 25%). Applied only when isCasual. */
  casualLoading?: number | null;
  /** Whether the employee is a casual (employment_type === 'casual'). */
  isCasual: boolean;
}

export interface RateFloorResult {
  /** True when the rate is known and meets/exceeds the applicable minimum. */
  ok: boolean;
  /** The applicable minimum (incl. casual loading when isCasual). */
  minimum: number;
  /** max(0, minimum - hourlyRate); 0 when ok or the rate is unknown. */
  shortfall: number;
  /** False when hourlyRate is null — caller should prompt to set a rate. */
  rateKnown: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function checkRateFloor(input: RateFloorInput): RateFloorResult {
  const loading =
    input.isCasual && input.casualLoading != null ? input.casualLoading : 0;
  const minimum = round2(input.baseHourlyRate * (1 + loading));
  if (input.hourlyRate == null) {
    return { ok: false, minimum, shortfall: 0, rateKnown: false };
  }
  // 1e-9 tolerance so exact-equal rates aren't flagged by float noise.
  const ok = input.hourlyRate + 1e-9 >= minimum;
  return {
    ok,
    minimum,
    shortfall: ok ? 0 : round2(minimum - input.hourlyRate),
    rateKnown: true,
  };
}
