// Allowance computation (AUDIT.md Feature 4 — Fair Work, Slice C).
//
// Pure: turns an employee's assigned allowances + their week's worked context
// into per-allowance dollar lines, emitted under the `allowance` payroll
// category. STOPS at the category output — mapping the dollars onto a Xero
// earnings line is the Xero workstream's job (flat/$ allowances are dollars,
// not hours, so that mapping is non-trivial and intentionally left out here).

export type AllowanceType = "flat" | "per_hour" | "per_shift" | "per_day";

export interface AllowanceInput {
  key: string;
  label: string;
  type: AllowanceType;
  /** The award amount in dollars, per the type's unit. */
  amount: number;
  taxable?: boolean;
}

export interface AllowanceWeekContext {
  /** Total worked hours in the week (excludes unpaid breaks). */
  workedHours: number;
  /** Number of shifts/assignments worked in the week. */
  shifts: number;
  /** Number of distinct calendar days worked in the week. */
  distinctDays: number;
}

export interface AllowanceLine {
  key: string;
  label: string;
  type: AllowanceType;
  amount: number;
  /** Units the amount was multiplied by (hours / shifts / days / 1 for flat). */
  units: number;
  /** amount × units, rounded to cents. */
  value: number;
  taxable: boolean;
}

export interface AllowanceResult {
  lines: AllowanceLine[];
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function unitsFor(type: AllowanceType, ctx: AllowanceWeekContext): number {
  switch (type) {
    case "per_hour":
      return Math.max(0, ctx.workedHours);
    case "per_shift":
      return Math.max(0, ctx.shifts);
    case "per_day":
      return Math.max(0, ctx.distinctDays);
    case "flat":
      // Flat allowance applies once for the week of work (0 if nothing worked).
      return ctx.workedHours > 0 || ctx.shifts > 0 || ctx.distinctDays > 0
        ? 1
        : 0;
  }
}

export function computeAllowances(
  assigned: AllowanceInput[],
  ctx: AllowanceWeekContext,
): AllowanceResult {
  const lines = assigned.map((a) => {
    const units = unitsFor(a.type, ctx);
    return {
      key: a.key,
      label: a.label,
      type: a.type,
      amount: a.amount,
      units,
      value: round2(a.amount * units),
      taxable: a.taxable ?? true,
    };
  });
  const total = round2(lines.reduce((s, l) => s + l.value, 0));
  return { lines, total };
}
