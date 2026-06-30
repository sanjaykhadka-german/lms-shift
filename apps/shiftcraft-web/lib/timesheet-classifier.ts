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
  type AwardThresholds,
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
// here per row. Optional `thresholds` lets tenants override the
// package defaults (3b.5).
export function classifyEmployeeWeek(
  weekStart: Date,
  perDayMs: number[],
  holidayDates: ReadonlySet<string>,
  thresholds?: Partial<AwardThresholds>,
): WeekBreakdown {
  return classifyWeek(buildDayInputs(weekStart, perDayMs), {
    holidayDates,
    thresholds,
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

// ─── Per-tenant award profile (Phase 2 #3b.5) ────────────────────────
//
// Tenants can override any subset of the @tracey/award defaults via
// sc_tenant_config.award_profile (jsonb). Missing fields fall through
// to the package defaults so callers can call the resolved helpers
// unconditionally. Bad / typo'd values are dropped during validation
// (defensive: a stored profile from a future schema version should
// degrade to defaults rather than crash a server render).

export interface AwardProfileOverrides {
  thresholds?: Partial<AwardThresholds>;
  overtimeMultiplier?: number;
  doubleOvertimeMultiplier?: number;
  penaltyMultipliers?: Partial<PenaltyMultipliers>;
  costPolicy?: CostPolicy;
}

const DEFAULT_THRESHOLDS_LOCAL: AwardThresholds = {
  dailyOrdinaryMinutes: 8 * 60,
  dailyOvertimeMinutes: 10 * 60,
  weeklyOrdinaryMinutes: 38 * 60,
  overtimeBasis: "daily",
  weeklyOvertimeFirstTierMinutes: 3 * 60,
};

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

// Defensive parser: trims any input shape down to known keys with
// validated types. Anything unrecognised is dropped silently.
function parseAwardProfile(raw: unknown): AwardProfileOverrides {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: AwardProfileOverrides = {};

  if (r.thresholds && typeof r.thresholds === "object") {
    const t = r.thresholds as Record<string, unknown>;
    const thresholds: Partial<AwardThresholds> = {};
    if (isFinitePositive(t.dailyOrdinaryMinutes)) {
      thresholds.dailyOrdinaryMinutes = Math.round(t.dailyOrdinaryMinutes);
    }
    if (isFinitePositive(t.dailyOvertimeMinutes)) {
      thresholds.dailyOvertimeMinutes = Math.round(t.dailyOvertimeMinutes);
    }
    if (isFinitePositive(t.weeklyOrdinaryMinutes)) {
      thresholds.weeklyOrdinaryMinutes = Math.round(t.weeklyOrdinaryMinutes);
    }
    if (t.overtimeBasis === "daily" || t.overtimeBasis === "weekly") {
      thresholds.overtimeBasis = t.overtimeBasis;
    }
    if (isFinitePositive(t.weeklyOvertimeFirstTierMinutes)) {
      thresholds.weeklyOvertimeFirstTierMinutes = Math.round(
        t.weeklyOvertimeFirstTierMinutes,
      );
    }
    if (Object.keys(thresholds).length > 0) out.thresholds = thresholds;
  }

  if (isFinitePositive(r.overtimeMultiplier)) {
    out.overtimeMultiplier = r.overtimeMultiplier;
  }
  if (isFinitePositive(r.doubleOvertimeMultiplier)) {
    out.doubleOvertimeMultiplier = r.doubleOvertimeMultiplier;
  }

  if (r.penaltyMultipliers && typeof r.penaltyMultipliers === "object") {
    const p = r.penaltyMultipliers as Record<string, unknown>;
    const pms: Partial<PenaltyMultipliers> = {};
    for (const k of ["weekday", "saturday", "sunday", "public_holiday"] as const) {
      if (isFinitePositive(p[k])) pms[k] = p[k] as number;
    }
    if (Object.keys(pms).length > 0) out.penaltyMultipliers = pms;
  }

  if (r.costPolicy === "max" || r.costPolicy === "stack") {
    out.costPolicy = r.costPolicy;
  }

  return out;
}

// Merge a partial thresholds override with the AU general-rule defaults.
export function resolveThresholds(
  overrides?: Partial<AwardThresholds>,
): AwardThresholds {
  return { ...DEFAULT_THRESHOLDS_LOCAL, ...overrides };
}

// Merge a partial penalty-multipliers override with the AU general-rule
// defaults. Each missing key falls back to the package default.
export function resolvePenaltyMultipliers(
  overrides?: Partial<PenaltyMultipliers>,
): PenaltyMultipliers {
  return { ...DEFAULT_PENALTY_MULTIPLIERS, ...overrides };
}

// Merge two AwardProfileOverrides — employee fields win over tenant
// fields at the leaf level (Phase 2 #3b.6). E.g. tenant sets
// penaltyMultipliers.sunday=1.75; employee sets
// penaltyMultipliers.weekday=1.10 only — final has both.
//
// `nested` containers (`thresholds`, `penaltyMultipliers`) merge their
// inner keys field-by-field; scalar overrides at the top level (cost
// policy, OT multipliers) just take the employee value when present.
//
// Pure function — no DB, no side effects. The tenant and employee
// values come from getTenantAwardProfile + getEmployeeAwardProfile.
export function mergeAwardProfiles(
  tenant: AwardProfileOverrides,
  employee?: AwardProfileOverrides,
): AwardProfileOverrides {
  if (!employee) return tenant;
  const out: AwardProfileOverrides = { ...tenant };
  if (employee.thresholds || tenant.thresholds) {
    out.thresholds = { ...tenant.thresholds, ...employee.thresholds };
  }
  if (employee.penaltyMultipliers || tenant.penaltyMultipliers) {
    out.penaltyMultipliers = {
      ...tenant.penaltyMultipliers,
      ...employee.penaltyMultipliers,
    };
  }
  if (employee.overtimeMultiplier != null) {
    out.overtimeMultiplier = employee.overtimeMultiplier;
  }
  if (employee.doubleOvertimeMultiplier != null) {
    out.doubleOvertimeMultiplier = employee.doubleOvertimeMultiplier;
  }
  if (employee.costPolicy) {
    out.costPolicy = employee.costPolicy;
  }
  return out;
}

// Convenience: classify + cost in one call using a tenant profile.
// Lets page.tsx call a single helper instead of threading three
// override fields through.
export function classifyAndCost(
  weekStart: Date,
  perDayMs: number[],
  holidayDates: ReadonlySet<string>,
  hourlyRate: number | null,
  profile: AwardProfileOverrides = {},
): { breakdown: WeekBreakdown; cost: WeekCost | null } {
  const breakdown = classifyWeek(buildDayInputs(weekStart, perDayMs), {
    holidayDates,
    thresholds: profile.thresholds,
  });
  const cost =
    hourlyRate != null
      ? computeAwardCost(breakdown, hourlyRate, {
          policy: profile.costPolicy,
          penaltyMultipliers: resolvePenaltyMultipliers(
            profile.penaltyMultipliers,
          ),
          overtimeMultiplier: profile.overtimeMultiplier,
          doubleOvertimeMultiplier: profile.doubleOvertimeMultiplier,
        })
      : null;
  return { breakdown, cost };
}

// Test-only: exposes the parser so spec coverage doesn't need a fake DB.
export const _parseAwardProfile = parseAwardProfile;
