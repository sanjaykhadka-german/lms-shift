// Fair Work MAPD → ShiftCraft transform (AUDIT.md Feature 4, Slice D).
//
// PURE: takes a recorded Modern Awards Pay Database (MAPD) payload and produces
// classification + allowance rows stamped with the FWC effective date. No
// network — the IO lives in apps/shiftcraft-web/lib/award/fairwork. This keeps
// the transform unit-testable against a recorded fixture.
//
// ⚠️ The MAPD field names below are CODED AGAINST THE DOCUMENTED SHAPE and are
// flagged `FWC: confirm`. Confirm each against the developer.fwc.gov.au
// "Try it out" responses + Data dictionary, then adjust the input interface +
// the fixture. The transform logic stays the same.
import type { AllowanceType } from "./allowances";

// ── Assumed MAPD input shape (confirm field names against the portal) ──
export interface FwcClassification {
  classificationName: string; // FWC: confirm (e.g. "classification")
  classificationLevel?: string; // FWC: confirm (level code; falls back to a slug of the name)
  baseHourlyRate?: number; // FWC: confirm (may arrive as a weekly rate instead)
  baseWeeklyRate?: number; // FWC: confirm (derive hourly = weekly / ordinaryHoursPerWeek)
  operativeFrom?: string; // FWC: confirm (ISO date)
}

export interface FwcAllowance {
  allowanceName: string; // FWC: confirm
  amount: number; // FWC: confirm (allowanceAmount)
  paymentFrequency?: string; // FWC: confirm (e.g. "Per hour" | "Per shift" | "Per day" | "Per week")
  isWageRelated?: boolean; // FWC: confirm (wage-related = taxable; expense = not)
  operativeFrom?: string; // FWC: confirm
}

export interface FwcAwardPayload {
  code: string;
  name?: string;
  operativeFrom?: string; // overall effective date for this rate-set
  ordinaryHoursPerWeek?: number; // FWC: confirm (default 38 for hourly derivation)
  classifications?: FwcClassification[];
  wageAllowances?: FwcAllowance[];
  expenseAllowances?: FwcAllowance[];
}

// ── Output: rows ready to upsert into sc_award_* ──
export interface TransformedClassification {
  levelCode: string;
  label: string;
  baseHourlyRate: number;
  effectiveFrom: string;
}

export interface TransformedAllowance {
  key: string;
  label: string;
  type: AllowanceType;
  amount: number;
  taxable: boolean;
  effectiveFrom: string;
}

export interface FwcTransformResult {
  awardCode: string;
  awardName: string;
  effectiveFrom: string;
  classifications: TransformedClassification[];
  allowances: TransformedAllowance[];
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "x";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// "Per hour" -> per_hour, "Per shift" -> per_shift, "Per day" -> per_day,
// everything else (incl. "Per week" / undefined) -> flat. FWC: confirm the
// vocabulary the API actually uses for paymentFrequency.
function allowanceType(frequency: string | undefined): AllowanceType {
  const f = (frequency ?? "").toLowerCase();
  if (f.includes("hour")) return "per_hour";
  if (f.includes("shift")) return "per_shift";
  if (f.includes("day")) return "per_day";
  return "flat";
}

export function transformFwcPayload(
  payload: FwcAwardPayload,
  asOf: string,
): FwcTransformResult {
  const effectiveFrom = payload.operativeFrom ?? asOf;
  const hoursPerWeek =
    payload.ordinaryHoursPerWeek && payload.ordinaryHoursPerWeek > 0
      ? payload.ordinaryHoursPerWeek
      : 38;

  const classifications: TransformedClassification[] = (
    payload.classifications ?? []
  )
    .map((c) => {
      const hourly =
        c.baseHourlyRate != null
          ? c.baseHourlyRate
          : c.baseWeeklyRate != null
            ? c.baseWeeklyRate / hoursPerWeek
            : null;
      if (hourly == null) return null;
      return {
        levelCode: c.classificationLevel?.trim() || slug(c.classificationName),
        label: c.classificationName,
        baseHourlyRate: round2(hourly),
        effectiveFrom: c.operativeFrom ?? effectiveFrom,
      };
    })
    .filter((x): x is TransformedClassification => x !== null);

  const mapAllowance = (a: FwcAllowance, taxable: boolean): TransformedAllowance => ({
    key: slug(a.allowanceName),
    label: a.allowanceName,
    type: allowanceType(a.paymentFrequency),
    amount: round2(a.amount),
    taxable,
    effectiveFrom: a.operativeFrom ?? effectiveFrom,
  });

  const allowances: TransformedAllowance[] = [
    ...(payload.wageAllowances ?? []).map((a) => mapAllowance(a, true)),
    // Expense allowances are reimbursements — typically not taxable. FWC: confirm.
    ...(payload.expenseAllowances ?? []).map((a) => mapAllowance(a, false)),
  ];

  return {
    awardCode: payload.code,
    awardName: payload.name ?? payload.code,
    effectiveFrom,
    classifications,
    allowances,
  };
}
