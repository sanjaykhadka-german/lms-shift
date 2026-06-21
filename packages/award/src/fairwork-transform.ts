// Fair Work MAPD → ShiftCraft transform (AUDIT.md Feature 4, Slice D).
//
// PURE: takes a Modern Awards Pay Database (MAPD) payload (assembled by
// apps/shiftcraft-web/lib/award/fairwork/client.ts) and produces classification
// + allowance rows stamped with the FWC effective date. No network — the IO
// lives in the client; this keeps the transform unit-testable.
//
// The field names below are the REAL MAPD response shape, verified live against
// api.fwc.gov.au/api/v1 (2026-06-21) for MA000059:
//   • /awards/{code}              → version list; carries `award_fixed_id`
//   • /awards/{fixed_id}/pay-rates       → classification + hourly rate rows
//   • /awards/{fixed_id}/wage-allowances → taxable allowances
//   • /awards/{fixed_id}/expense-allowances → reimbursements (non-taxable)
// All rows are snake_case and paginated; the client flattens the pages and
// hands the raw arrays in here.
import type { AllowanceType } from "./allowances";

// ── Raw MAPD rows (snake_case, as returned by the API) ──
//
// A pay-rates row pairs a classification with its rate. `calculated_rate` is the
// pre-derived hourly figure (calculated_rate_type === "Hourly"); `base_rate` is
// usually the weekly figure. `employee_rate_type_code === "AD"` is the adult
// minimum — juniors/apprentices arrive as separate rows (other codes / null)
// and are intentionally dropped (they're percentages of the adult floor).
export interface FwcPayRateRow {
  classification_fixed_id?: number;
  classification?: string; // e.g. "MI 1"
  classification_level?: number | string; // e.g. 1
  base_rate?: number;
  base_rate_type?: string; // "Weekly" | "Hourly" | …
  calculated_rate?: number; // e.g. 24.28
  calculated_rate_type?: string; // "Hourly" | …
  employee_rate_type_code?: string | null; // "AD" = adult
  operative_from?: string; // ISO date
  operative_to?: string | null;
}

export interface FwcAllowanceRow {
  allowance?: string; // human label
  allowance_amount?: number; // dollar value
  payment_frequency?: string; // e.g. "per hour or part thereof…", "per day"
  is_all_purpose?: boolean;
  operative_from?: string;
  operative_to?: string | null;
}

export interface FwcAwardPayload {
  code: string;
  name?: string;
  /** Optional override for the overall effective date; otherwise derived from
   *  the most recent operative pay-rate row, falling back to `asOf`. */
  operativeFrom?: string;
  payRates?: FwcPayRateRow[];
  wageAllowances?: FwcAllowanceRow[];
  expenseAllowances?: FwcAllowanceRow[];
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
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "x"
  );
}

// A short, stable, unique level code derived from the classification name:
// "MI 1" → "MI1". The DB column is unbounded text, so we don't truncate (we
// rely on the name being unique within an award). Falls back to the numeric
// level when the name is blank.
function levelCodeFor(
  name: string,
  level: number | string | undefined,
): string {
  const compact = name.replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  if (compact) return compact;
  const lv = level != null ? `${level}`.trim() : "";
  return lv ? `L${lv}` : "L";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Map the free-text payment frequency onto our allowance type vocabulary.
// The API uses phrases like "per hour or part thereof unless stated otherwise",
// "per shift", "per day", "per week".
function allowanceType(frequency: string | undefined): AllowanceType {
  const f = (frequency ?? "").toLowerCase();
  if (f.includes("hour")) return "per_hour";
  if (f.includes("shift")) return "per_shift";
  if (f.includes("day")) return "per_day";
  return "flat";
}

// Whether a row is operative as of `asOf` (inclusive). Open-ended `operative_to`
// (null) means "current".
function isOperative(
  from: string | undefined,
  to: string | null | undefined,
  asOf: string,
): boolean {
  if (from && from > asOf) return false;
  if (to && to < asOf) return false;
  return true;
}

// Pick the hourly figure from a pay-rates row. Prefer the pre-calculated hourly
// rate; fall back to a base rate already expressed hourly; last resort, trust
// `calculated_rate` as hourly.
function hourlyRate(r: FwcPayRateRow): number | null {
  if (r.calculated_rate != null && /hour/i.test(r.calculated_rate_type ?? ""))
    return r.calculated_rate;
  if (r.base_rate != null && /hour/i.test(r.base_rate_type ?? ""))
    return r.base_rate;
  if (r.calculated_rate != null) return r.calculated_rate;
  return null;
}

export function transformFwcPayload(
  payload: FwcAwardPayload,
  asOf: string,
): FwcTransformResult {
  // Adult, currently-operative pay rates only.
  const payRates = (payload.payRates ?? []).filter(
    (r) =>
      (r.employee_rate_type_code ?? "").toUpperCase() === "AD" &&
      isOperative(r.operative_from, r.operative_to, asOf),
  );

  // Overall effective date: caller override, else the latest operative date in
  // the current rate-set, else the as-of date.
  const latestRateDate = payRates
    .map((r) => r.operative_from)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  const effectiveFrom = payload.operativeFrom ?? latestRateDate ?? asOf;

  // One classification per level code, keeping the most recent (then highest).
  const byLevel = new Map<string, TransformedClassification>();
  for (const r of payRates) {
    const name = (r.classification ?? "").trim();
    if (!name) continue;
    const hourly = hourlyRate(r);
    if (hourly == null) continue;
    const levelCode = levelCodeFor(name, r.classification_level);
    const eff = r.operative_from ?? effectiveFrom;
    const rounded = round2(hourly);
    const existing = byLevel.get(levelCode);
    if (
      !existing ||
      eff > existing.effectiveFrom ||
      (eff === existing.effectiveFrom && rounded > existing.baseHourlyRate)
    ) {
      byLevel.set(levelCode, {
        levelCode,
        label: name,
        baseHourlyRate: rounded,
        effectiveFrom: eff,
      });
    }
  }
  const classifications = [...byLevel.values()];

  const mapAllowance = (
    a: FwcAllowanceRow,
    taxable: boolean,
  ): TransformedAllowance | null => {
    const name = (a.allowance ?? "").trim();
    if (!name || a.allowance_amount == null) return null;
    if (!isOperative(a.operative_from, a.operative_to, asOf)) return null;
    return {
      key: slug(name),
      label: name,
      type: allowanceType(a.payment_frequency),
      amount: round2(a.allowance_amount),
      taxable,
      effectiveFrom: a.operative_from ?? effectiveFrom,
    };
  };

  // Wage allowances (taxable) take precedence over expense allowances (not) on
  // a key collision; within wage, keep the most recent.
  const byKey = new Map<string, TransformedAllowance>();
  for (const a of payload.wageAllowances ?? []) {
    const m = mapAllowance(a, true);
    if (!m) continue;
    const existing = byKey.get(m.key);
    if (!existing || m.effectiveFrom > existing.effectiveFrom) byKey.set(m.key, m);
  }
  for (const a of payload.expenseAllowances ?? []) {
    const m = mapAllowance(a, false);
    if (m && !byKey.has(m.key)) byKey.set(m.key, m);
  }
  const allowances = [...byKey.values()];

  return {
    awardCode: payload.code,
    awardName: payload.name ?? payload.code,
    effectiveFrom,
    classifications,
    allowances,
  };
}
