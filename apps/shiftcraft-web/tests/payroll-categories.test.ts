import { describe, it, expect, vi } from "vitest";
import type { WeekBreakdown } from "@tracey/award";
import type { ScPayrollCategory } from "@tracey/db";

vi.mock("@tracey/db", () => ({}));

const {
  PAYROLL_CATEGORIES,
  PAYROLL_CATEGORY_LABEL,
  buildCategoryUnitsFromBreakdown,
  findMissingMappings,
} = await import("~/lib/payroll/categories");

// ─── Test fixture helpers ───────────────────────────────────────────

interface DayFixture {
  date: string;
  worked: number; // minutes
  ordinary: number;
  overtime: number;
  doubleOvertime?: number;
  penalty: "weekday" | "saturday" | "sunday" | "public_holiday";
}

function makeBreakdown(days: DayFixture[]): WeekBreakdown {
  return {
    days: days.map((d) => ({
      date: d.date,
      workedMinutes: d.worked,
      ordinaryMinutes: d.ordinary,
      overtimeMinutes: d.overtime,
      doubleOvertimeMinutes: d.doubleOvertime ?? 0,
      penaltyCategory: d.penalty,
    })),
    totals: {
      workedMinutes: days.reduce((s, d) => s + d.worked, 0),
      ordinaryMinutes: days.reduce((s, d) => s + d.ordinary, 0),
      overtimeMinutes: days.reduce((s, d) => s + d.overtime, 0),
      doubleOvertimeMinutes: days.reduce(
        (s, d) => s + (d.doubleOvertime ?? 0),
        0,
      ),
    },
    thresholds: {
      dailyOrdinaryMinutes: 8 * 60,
      dailyOvertimeMinutes: 10 * 60,
      weeklyOrdinaryMinutes: 38 * 60,
    },
  };
}

describe("PAYROLL_CATEGORIES contract", () => {
  it("includes every category the schema CHECK constraint allows", () => {
    expect(PAYROLL_CATEGORIES).toEqual([
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
    ]);
  });

  it("has a friendly label for every category", () => {
    for (const cat of PAYROLL_CATEGORIES) {
      expect(PAYROLL_CATEGORY_LABEL[cat]).toBeTruthy();
      expect(PAYROLL_CATEGORY_LABEL[cat].length).toBeGreaterThan(0);
    }
  });
});

describe("buildCategoryUnitsFromBreakdown", () => {
  it("returns an empty map when no day has worked minutes", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        {
          date: "2026-06-01",
          worked: 0,
          ordinary: 0,
          overtime: 0,
          penalty: "weekday",
        },
      ]),
    );
    expect(result.size).toBe(0);
  });

  it("splits a weekday into ordinary + overtime buckets", () => {
    // Monday 09:00–19:00 = 600m worked, classifier split 8h ord + 2h OT
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        {
          date: "2026-06-01", // Monday
          worked: 600,
          ordinary: 480,
          overtime: 120,
          penalty: "weekday",
        },
      ]),
    );
    expect(result.get("ordinary")).toEqual([8, 0, 0, 0, 0, 0, 0]);
    expect(result.get("overtime")).toEqual([2, 0, 0, 0, 0, 0, 0]);
    expect(result.has("penalty_sat")).toBe(false);
  });

  it("folds weekday OT 2x into 'overtime' when overtime_double is unmapped", () => {
    // 3h OT 1.5x + 2h OT 2x and no overtime_double mapping → both bands
    // land in the single 'overtime' bucket (the legacy/no-regression path).
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        {
          date: "2026-06-01",
          worked: 13 * 60,
          ordinary: 8 * 60,
          overtime: 3 * 60,
          doubleOvertime: 2 * 60,
          penalty: "weekday",
        },
      ]),
    );
    expect(result.get("ordinary")).toEqual([8, 0, 0, 0, 0, 0, 0]);
    expect(result.get("overtime")).toEqual([5, 0, 0, 0, 0, 0, 0]);
    expect(result.has("overtime_double")).toBe(false);
  });

  it("splits weekday OT 2x onto 'overtime_double' when that category is mapped", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        {
          date: "2026-06-01",
          worked: 13 * 60,
          ordinary: 8 * 60,
          overtime: 3 * 60,
          doubleOvertime: 2 * 60,
          penalty: "weekday",
        },
      ]),
      new Set<ScPayrollCategory>(["overtime_double"]),
    );
    expect(result.get("ordinary")).toEqual([8, 0, 0, 0, 0, 0, 0]);
    expect(result.get("overtime")).toEqual([3, 0, 0, 0, 0, 0, 0]);
    expect(result.get("overtime_double")).toEqual([2, 0, 0, 0, 0, 0, 0]);
  });

  it("rolls all Saturday minutes into penalty_sat (incl. OT)", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        // 5 empty days, then Saturday with 6h, then Sunday empty.
        { date: "2026-06-01", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-02", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        // Saturday: 6h ordinary + 1h OT — but on Sat, all 7h flow to penalty_sat.
        { date: "2026-06-06", worked: 420, ordinary: 360, overtime: 60, penalty: "saturday" },
        { date: "2026-06-07", worked: 0, ordinary: 0, overtime: 0, penalty: "sunday" },
      ]),
    );
    expect(result.get("penalty_sat")).toEqual([0, 0, 0, 0, 0, 7, 0]);
    expect(result.has("ordinary")).toBe(false);
    expect(result.has("overtime")).toBe(false);
  });

  it("splits Saturday OT into penalty_sat_ot when the combo is mapped", () => {
    // Same 6h ord + 1h OT Saturday, but now the tenant has mapped the
    // penalty_sat_ot combo — ordinary stays in penalty_sat, OT moves out.
    const mapped = new Set<ScPayrollCategory>(["penalty_sat", "penalty_sat_ot"]);
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-02", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-06", worked: 420, ordinary: 360, overtime: 60, penalty: "saturday" },
        { date: "2026-06-07", worked: 0, ordinary: 0, overtime: 0, penalty: "sunday" },
      ]),
      mapped,
    );
    expect(result.get("penalty_sat")).toEqual([0, 0, 0, 0, 0, 6, 0]);
    expect(result.get("penalty_sat_ot")).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });

  it("does NOT split when only the base penalty is mapped (combo unmapped)", () => {
    const mapped = new Set<ScPayrollCategory>(["penalty_sat"]);
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-02", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-06", worked: 420, ordinary: 360, overtime: 60, penalty: "saturday" },
        { date: "2026-06-07", worked: 0, ordinary: 0, overtime: 0, penalty: "sunday" },
      ]),
      mapped,
    );
    expect(result.get("penalty_sat")).toEqual([0, 0, 0, 0, 0, 7, 0]);
    expect(result.has("penalty_sat_ot")).toBe(false);
  });

  it("rolls all Sunday minutes into penalty_sun", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-02", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-06", worked: 0, ordinary: 0, overtime: 0, penalty: "saturday" },
        { date: "2026-06-07", worked: 240, ordinary: 240, overtime: 0, penalty: "sunday" },
      ]),
    );
    expect(result.get("penalty_sun")).toEqual([0, 0, 0, 0, 0, 0, 4]);
  });

  it("rolls all public_holiday minutes into penalty_ph", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 480, ordinary: 480, overtime: 0, penalty: "public_holiday" },
        { date: "2026-06-02", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-06", worked: 0, ordinary: 0, overtime: 0, penalty: "saturday" },
        { date: "2026-06-07", worked: 0, ordinary: 0, overtime: 0, penalty: "sunday" },
      ]),
    );
    expect(result.get("penalty_ph")).toEqual([8, 0, 0, 0, 0, 0, 0]);
  });

  it("rounds hours to 2 decimal places", () => {
    // 17 minutes = 0.2833... hours → 0.28
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 17, ordinary: 17, overtime: 0, penalty: "weekday" },
      ]),
    );
    expect(result.get("ordinary")?.[0]).toBe(0.28);
  });

  it("handles a mixed week with weekday + weekend totals", () => {
    const result = buildCategoryUnitsFromBreakdown(
      makeBreakdown([
        { date: "2026-06-01", worked: 480, ordinary: 480, overtime: 0, penalty: "weekday" },
        { date: "2026-06-02", worked: 480, ordinary: 480, overtime: 0, penalty: "weekday" },
        { date: "2026-06-03", worked: 540, ordinary: 480, overtime: 60, penalty: "weekday" },
        { date: "2026-06-04", worked: 0, ordinary: 0, overtime: 0, penalty: "weekday" },
        { date: "2026-06-05", worked: 480, ordinary: 480, overtime: 0, penalty: "weekday" },
        { date: "2026-06-06", worked: 240, ordinary: 240, overtime: 0, penalty: "saturday" },
        { date: "2026-06-07", worked: 0, ordinary: 0, overtime: 0, penalty: "sunday" },
      ]),
    );
    expect(result.get("ordinary")).toEqual([8, 8, 8, 0, 8, 0, 0]);
    expect(result.get("overtime")).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(result.get("penalty_sat")).toEqual([0, 0, 0, 0, 0, 4, 0]);
  });
});

describe("findMissingMappings", () => {
  const someMapping = new Map<ScPayrollCategory, string>([
    ["ordinary", "rate-ord"],
    ["overtime", "rate-ot"],
  ]);

  it("returns [] when every used category has a mapping", () => {
    const used = new Set<ScPayrollCategory>(["ordinary", "overtime"]);
    expect(findMissingMappings(used, someMapping)).toEqual([]);
  });

  it("returns the missing categories in canonical display order", () => {
    const used = new Set<ScPayrollCategory>([
      "penalty_sun",
      "ordinary",
      "penalty_sat",
    ]);
    expect(findMissingMappings(used, someMapping)).toEqual([
      "penalty_sat",
      "penalty_sun",
    ]);
  });

  it("dedupes a category that appears twice in the input", () => {
    const used = ["penalty_sat", "penalty_sat", "penalty_sun"] as const;
    expect(findMissingMappings(used, someMapping)).toEqual([
      "penalty_sat",
      "penalty_sun",
    ]);
  });

  it("returns [] for empty input", () => {
    expect(findMissingMappings([], someMapping)).toEqual([]);
  });
});
