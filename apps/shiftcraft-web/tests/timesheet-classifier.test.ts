import { describe, expect, it, vi } from "vitest";

// lib/clock.ts is "server-only" so vitest must stub it before lib/timesheet-
// classifier.ts is imported. The classifier helper only needs addDays +
// fmtIsoDate + fmtHours; provide deterministic local replacements.
vi.mock("server-only", () => ({}));

vi.mock("~/lib/clock", () => ({
  addDays: (d: Date, days: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + days);
    return r;
  },
  fmtIsoDate: (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
  fmtHours: (ms: number) => {
    if (ms <= 0) return "0:00";
    const totalMinutes = Math.round(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${String(m).padStart(2, "0")}`;
  },
}));

import {
  _parseAwardProfile,
  buildDayInputs,
  classifyEmployeeWeek,
  computeAwardCost,
  countPublicHolidays,
  fmtBreakdown,
  highestPenaltyCategory,
  mergeAwardProfiles,
  resolvePenaltyMultipliers,
  resolveThresholds,
  roundCents,
  type AwardProfileOverrides,
} from "~/lib/timesheet-classifier";

// 2026-05-25 is a Monday — matches the startOfWeek output from clock.ts.
const MON = new Date(2026, 4, 25); // Month is 0-indexed in Date.

function ms(hours: number): number {
  return Math.round(hours * 3_600_000);
}

describe("buildDayInputs", () => {
  it("zips weekStart + perDayMs into DayInput[] keyed by ISO date", () => {
    const inputs = buildDayInputs(MON, [
      ms(8), // Mon
      ms(8), // Tue
      ms(8), // Wed
      ms(8), // Thu
      ms(8), // Fri
      ms(0), // Sat
      ms(0), // Sun
    ]);
    expect(inputs.map((i) => i.date)).toEqual([
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
    ]);
    expect(inputs.map((i) => i.workedMinutes)).toEqual([
      480,
      480,
      480,
      480,
      480,
      0,
      0,
    ]);
  });

  it("rounds sub-minute ms to whole minutes so the classifier never sees floats", () => {
    const inputs = buildDayInputs(MON, [3_600_000 * 7.6]); // 7h 36m in ms
    expect(inputs[0]!.workedMinutes).toBe(456);
  });
});

describe("classifyEmployeeWeek", () => {
  it("returns a WeekBreakdown with daily + weekly classification applied", () => {
    // Mon-Fri 9h each: day-pass 40 ord + 5 OT 1.5×; week cap pushes 2h
    // from Fri's ordinary into OT 1.5×.
    const out = classifyEmployeeWeek(
      MON,
      [ms(9), ms(9), ms(9), ms(9), ms(9), 0, 0],
      new Set<string>(),
    );
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(7 * 60);
    expect(out.totals.doubleOvertimeMinutes).toBe(0);
  });

  it("threads holidayDates into the classifier so days get penalty tags", () => {
    // 2026-04-25 is a Saturday ANZAC Day. Use as Sat in the week
    // 2026-04-20 (Mon).
    const monApr20 = new Date(2026, 3, 20);
    const out = classifyEmployeeWeek(
      monApr20,
      [0, 0, 0, 0, 0, ms(8), 0],
      new Set(["2026-04-25"]),
    );
    const sat = out.days.find((d) => d.date === "2026-04-25")!;
    expect(sat.penaltyCategory).toBe("public_holiday");
  });
});

describe("fmtBreakdown", () => {
  it("returns null when the week has zero worked minutes", () => {
    const out = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, 0], new Set());
    expect(fmtBreakdown(out)).toBeNull();
  });

  it("drops zero bands and joins the rest with middle-dots", () => {
    // 7h on Monday → 7h ord only.
    const out = classifyEmployeeWeek(MON, [ms(7), 0, 0, 0, 0, 0, 0], new Set());
    expect(fmtBreakdown(out)).toBe("7:00 ord");
  });

  it("shows ord + OT 1.5× when daily threshold is crossed", () => {
    // 9h on Monday → 8h ord + 1h OT 1.5×.
    const out = classifyEmployeeWeek(MON, [ms(9), 0, 0, 0, 0, 0, 0], new Set());
    expect(fmtBreakdown(out)).toBe("8:00 ord · 1:00 OT 1.5×");
  });

  it("shows all three bands when daily OT 2× threshold is crossed", () => {
    // 12h on Monday → 8h ord + 2h OT 1.5× + 2h OT 2×.
    const out = classifyEmployeeWeek(
      MON,
      [ms(12), 0, 0, 0, 0, 0, 0],
      new Set(),
    );
    expect(fmtBreakdown(out)).toBe(
      "8:00 ord · 2:00 OT 1.5× · 2:00 OT 2×",
    );
  });
});

describe("countPublicHolidays", () => {
  it("counts days whose penaltyCategory is public_holiday", () => {
    // Week containing two holidays from holidayDates.
    const monMar23 = new Date(2026, 2, 23);
    const out = classifyEmployeeWeek(
      monMar23,
      [ms(8), ms(8), ms(8), ms(8), ms(8), 0, 0],
      new Set(["2026-03-25", "2026-03-27"]), // Wed + Fri
    );
    expect(countPublicHolidays(out)).toBe(2);
  });

  it("returns 0 when no holidays in the week", () => {
    const out = classifyEmployeeWeek(MON, [ms(8), ms(8), 0, 0, 0, 0, 0], new Set());
    expect(countPublicHolidays(out)).toBe(0);
  });
});

describe("highestPenaltyCategory", () => {
  it("picks public_holiday over sunday/saturday/weekday when present", () => {
    const out = classifyEmployeeWeek(
      MON,
      [ms(8), 0, 0, 0, 0, 0, 0],
      new Set(["2026-05-25"]), // Monday is a holiday
    );
    expect(highestPenaltyCategory(out)).toBe("public_holiday");
  });

  it("picks sunday over saturday/weekday", () => {
    // Week Mon-Sun, only Sat + Sun worked, no holidays.
    const out = classifyEmployeeWeek(
      MON,
      [0, 0, 0, 0, 0, ms(4), ms(4)],
      new Set(),
    );
    expect(highestPenaltyCategory(out)).toBe("sunday");
  });

  it("picks saturday when only Sat is worked and no Sun/holiday", () => {
    const out = classifyEmployeeWeek(
      MON,
      [0, 0, 0, 0, 0, ms(4), 0],
      new Set(),
    );
    // Whole-week scan still sees Sunday day-row (workedMinutes=0) tagged
    // 'sunday' from day-of-week derivation — so highest is "sunday".
    // This documents the behaviour: highestPenaltyCategory considers
    // ALL days in the breakdown, not just worked-positive ones. A
    // future slice may want to filter to worked-only; for now the
    // classifier scans all 7 day-rows.
    expect(highestPenaltyCategory(out)).toBe("sunday");
  });

  it("returns 'weekday' when only Mon-Fri days exist in the breakdown", () => {
    // Build a breakdown with only weekday inputs.
    const out = classifyEmployeeWeek(MON, [ms(8), ms(8), ms(8), ms(8), ms(8)], new Set());
    expect(highestPenaltyCategory(out)).toBe("weekday");
  });
});

describe("computeAwardCost — pure-weekday week", () => {
  it("equals rate × hours when there's no OT and no penalty bands", () => {
    // 8h on Monday only @ $30/h → $240 flat. No OT, no weekend, no holiday.
    const breakdown = classifyEmployeeWeek(MON, [ms(8), 0, 0, 0, 0, 0, 0], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(240);
    expect(cost.policy).toBe("max");
  });

  it("applies OT 1.5× on the OT band only — weekday OT", () => {
    // 9h Monday: 8h ord + 1h OT. @ $30/h:
    //   ordinary cost = 8 × 30 × 1.0 (weekday) = $240
    //   ot cost       = 1 × 30 × max(1.0 weekday, 1.5 OT) = $45
    // Total $285.
    const breakdown = classifyEmployeeWeek(MON, [ms(9), 0, 0, 0, 0, 0, 0], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(285);
  });

  it("applies OT 2× on the double-OT band only", () => {
    // 12h Monday: 8h ord + 2h OT + 2h double-OT. @ $30/h:
    //   ord    = 8 × 30 × 1.0 = $240
    //   ot1.5  = 2 × 30 × 1.5 = $90
    //   ot2.0  = 2 × 30 × 2.0 = $120
    // Total $450.
    const breakdown = classifyEmployeeWeek(MON, [ms(12), 0, 0, 0, 0, 0, 0], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(450);
  });
});

describe("computeAwardCost — penalty days under 'max' policy", () => {
  it("Saturday ordinary work pays at the saturday penalty (1.25×), not OT", () => {
    // 6h on Saturday only @ $30/h. No OT.
    //   ord = 6 × 30 × 1.25 (sat) = $225
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, ms(6), 0], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(225);
  });

  it("Sunday ordinary work pays at sunday (1.5×); same band as OT, no extra stacking", () => {
    // 6h on Sunday only @ $30/h.
    //   ord = 6 × 30 × 1.5 (sun) = $270
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(6)], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(270);
  });

  it("Public-holiday work pays at 2.5× even for ordinary hours", () => {
    // 6h on a public-holiday Monday @ $30/h.
    //   ord = 6 × 30 × 2.5 (pubhol) = $450
    const breakdown = classifyEmployeeWeek(
      MON,
      [ms(6), 0, 0, 0, 0, 0, 0],
      new Set(["2026-05-25"]),
    );
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(450);
  });

  it("max policy: 9h on a Sunday → ordinary at 1.5×, OT at max(1.5,1.5)=1.5×", () => {
    // 9h Sunday @ $30: 8h ord + 1h OT.
    //   ord  = 8 × 30 × 1.5 (sun)         = $360
    //   ot   = 1 × 30 × max(1.5 sun, 1.5 OT) = $45
    // Total $405. (Under "max" policy, OT does NOT additionally stack.)
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(9)], new Set());
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(405);
  });

  it("max policy: 9h on a public holiday → ordinary at 2.5×, OT at max(2.5,1.5)=2.5×", () => {
    // 9h on public holiday Mon @ $30: 8h ord + 1h OT.
    //   ord  = 8 × 30 × 2.5             = $600
    //   ot   = 1 × 30 × max(2.5, 1.5)   = $75
    // Total $675.
    const breakdown = classifyEmployeeWeek(
      MON,
      [ms(9), 0, 0, 0, 0, 0, 0],
      new Set(["2026-05-25"]),
    );
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(675);
  });
});

describe("computeAwardCost — 'stack' policy", () => {
  it("stacks penalty × OT multipliers on the OT band", () => {
    // 9h on a Sunday @ $30:
    //   ord  = 8 × 30 × 1.5           = $360
    //   ot   = 1 × 30 × (1.5 × 1.5)   = 67.50
    // Total $427.50.
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(9)], new Set());
    const cost = computeAwardCost(breakdown, 30, { policy: "stack" });
    expect(roundCents(cost.totalCost)).toBe(427.5);
  });

  it("stacks penalty × double-OT for the double-OT band", () => {
    // 12h on a Sunday @ $30:
    //   ord  = 8 × 30 × 1.5         = $360
    //   ot   = 2 × 30 × (1.5 × 1.5) = $135
    //   ot2  = 2 × 30 × (1.5 × 2.0) = $180
    // Total $675.
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(12)], new Set());
    const cost = computeAwardCost(breakdown, 30, { policy: "stack" });
    expect(roundCents(cost.totalCost)).toBe(675);
  });
});

describe("computeAwardCost — week with OT cascade", () => {
  it("Mon-Fri 9h shifts 2h from Fri ordinary into OT — cost reflects the cascade", () => {
    // Day-pass: 40h ord + 5h OT @ $30. Week cap forces 2h Fri ord → OT.
    // Final: 38h ord + 7h OT.
    //   ord  = 38 × 30 × 1.0 = $1140
    //   ot   = 7  × 30 × 1.5 = $315
    // Total $1455.
    const breakdown = classifyEmployeeWeek(
      MON,
      [ms(9), ms(9), ms(9), ms(9), ms(9), 0, 0],
      new Set(),
    );
    const cost = computeAwardCost(breakdown, 30);
    expect(roundCents(cost.totalCost)).toBe(1455);
  });
});

describe("computeAwardCost — per-day breakdown", () => {
  it("returns a DayCost row per day with the right penaltyCategory tag", () => {
    const breakdown = classifyEmployeeWeek(
      MON,
      [ms(8), 0, 0, 0, 0, ms(4), 0],
      new Set(),
    );
    const cost = computeAwardCost(breakdown, 30);
    expect(cost.perDay).toHaveLength(7);
    const mon = cost.perDay.find((d) => d.date === "2026-05-25")!;
    const sat = cost.perDay.find((d) => d.date === "2026-05-30")!;
    expect(mon.penaltyCategory).toBe("weekday");
    expect(roundCents(mon.totalCost)).toBe(8 * 30); // 240
    expect(sat.penaltyCategory).toBe("saturday");
    expect(roundCents(sat.totalCost)).toBe(4 * 30 * 1.25); // 150
    expect(roundCents(cost.totalCost)).toBe(240 + 150);
  });
});

describe("computeAwardCost — option overrides", () => {
  it("honors a custom penaltyMultipliers map (e.g. 1.75× sunday)", () => {
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(8)], new Set());
    const cost = computeAwardCost(breakdown, 30, {
      penaltyMultipliers: {
        weekday: 1.0,
        saturday: 1.5,
        sunday: 1.75,
        public_holiday: 2.5,
      },
    });
    expect(roundCents(cost.totalCost)).toBe(8 * 30 * 1.75); // 420
  });

  it("honors a custom overtimeMultiplier (e.g. 2.0× instead of 1.5×)", () => {
    // 9h Mon @ $30 with OT multiplier raised to 2.0×.
    //   ord = 8 × 30 × 1.0          = $240
    //   ot  = 1 × 30 × max(1.0, 2.0) = $60
    // Total $300.
    const breakdown = classifyEmployeeWeek(MON, [ms(9), 0, 0, 0, 0, 0, 0], new Set());
    const cost = computeAwardCost(breakdown, 30, { overtimeMultiplier: 2.0 });
    expect(roundCents(cost.totalCost)).toBe(300);
  });
});

describe("roundCents", () => {
  it("rounds to two decimals", () => {
    expect(roundCents(1.234)).toBe(1.23);
    expect(roundCents(1.235)).toBe(1.24);
    expect(roundCents(0)).toBe(0);
  });
});

describe("_parseAwardProfile — defensive parsing of stored jsonb", () => {
  it("returns {} for null / undefined / non-object input", () => {
    expect(_parseAwardProfile(null)).toEqual({});
    expect(_parseAwardProfile(undefined)).toEqual({});
    expect(_parseAwardProfile("oops")).toEqual({});
    expect(_parseAwardProfile(42)).toEqual({});
  });

  it("returns {} for an empty object — no overrides set", () => {
    expect(_parseAwardProfile({})).toEqual({});
  });

  it("accepts a fully-populated profile and rounds threshold minutes", () => {
    const out = _parseAwardProfile({
      thresholds: {
        dailyOrdinaryMinutes: 456.7,
        dailyOvertimeMinutes: 600,
        weeklyOrdinaryMinutes: 2400,
      },
      overtimeMultiplier: 1.5,
      doubleOvertimeMultiplier: 2.0,
      penaltyMultipliers: {
        weekday: 1.0,
        saturday: 1.5,
        sunday: 1.75,
        public_holiday: 2.5,
      },
      costPolicy: "stack",
    });
    expect(out).toEqual({
      thresholds: {
        dailyOrdinaryMinutes: 457,
        dailyOvertimeMinutes: 600,
        weeklyOrdinaryMinutes: 2400,
      },
      overtimeMultiplier: 1.5,
      doubleOvertimeMultiplier: 2.0,
      penaltyMultipliers: {
        weekday: 1.0,
        saturday: 1.5,
        sunday: 1.75,
        public_holiday: 2.5,
      },
      costPolicy: "stack",
    });
  });

  it("drops zero / negative / NaN numeric values silently", () => {
    expect(
      _parseAwardProfile({
        thresholds: {
          dailyOrdinaryMinutes: 0,
          dailyOvertimeMinutes: -5,
          weeklyOrdinaryMinutes: Number.NaN,
        },
        overtimeMultiplier: 0,
        penaltyMultipliers: { weekday: -1 },
      }),
    ).toEqual({});
  });

  it("drops unknown penalty-multiplier keys", () => {
    const out = _parseAwardProfile({
      penaltyMultipliers: {
        weekday: 1.0,
        christmas_eve: 3.0,
        saturday: 1.25,
      },
    });
    expect(out.penaltyMultipliers).toEqual({
      weekday: 1.0,
      saturday: 1.25,
    });
  });

  it("rejects an unknown costPolicy and drops it", () => {
    expect(_parseAwardProfile({ costPolicy: "double-stack" })).toEqual({});
    expect(_parseAwardProfile({ costPolicy: "max" })).toEqual({
      costPolicy: "max",
    });
    expect(_parseAwardProfile({ costPolicy: "stack" })).toEqual({
      costPolicy: "stack",
    });
  });

  it("preserves partial overrides — tenant overrides just costPolicy", () => {
    expect(_parseAwardProfile({ costPolicy: "stack" })).toEqual({
      costPolicy: "stack",
    });
  });

  it("preserves partial thresholds and drops the empty container", () => {
    // thresholds object exists but no valid numbers inside → no
    // thresholds field on the result.
    const out = _parseAwardProfile({
      thresholds: { dailyOrdinaryMinutes: "not a number" },
    });
    expect(out).toEqual({});
  });
});

describe("resolveThresholds — merge override with package defaults", () => {
  it("returns the AU baseline when no override given", () => {
    expect(resolveThresholds()).toEqual({
      dailyOrdinaryMinutes: 480,
      dailyOvertimeMinutes: 600,
      weeklyOrdinaryMinutes: 2280,
    });
  });

  it("merges a partial override (e.g. just weekly cap)", () => {
    expect(resolveThresholds({ weeklyOrdinaryMinutes: 2400 })).toEqual({
      dailyOrdinaryMinutes: 480,
      dailyOvertimeMinutes: 600,
      weeklyOrdinaryMinutes: 2400,
    });
  });

  it("merges a full override", () => {
    expect(
      resolveThresholds({
        dailyOrdinaryMinutes: 456,
        dailyOvertimeMinutes: 576,
        weeklyOrdinaryMinutes: 2400,
      }),
    ).toEqual({
      dailyOrdinaryMinutes: 456,
      dailyOvertimeMinutes: 576,
      weeklyOrdinaryMinutes: 2400,
    });
  });
});

describe("resolvePenaltyMultipliers — merge override with package defaults", () => {
  it("returns the AU baseline when no override given", () => {
    expect(resolvePenaltyMultipliers()).toEqual({
      weekday: 1.0,
      saturday: 1.25,
      sunday: 1.5,
      public_holiday: 2.5,
    });
  });

  it("overrides just the Sunday rate, leaves the rest at defaults", () => {
    expect(resolvePenaltyMultipliers({ sunday: 1.75 })).toEqual({
      weekday: 1.0,
      saturday: 1.25,
      sunday: 1.75,
      public_holiday: 2.5,
    });
  });
});

describe("mergeAwardProfiles — per-field employee → tenant → defaults", () => {
  it("returns the tenant profile unchanged when employee is undefined", () => {
    const tenant: AwardProfileOverrides = {
      thresholds: { weeklyOrdinaryMinutes: 2400 },
      costPolicy: "max",
    };
    expect(mergeAwardProfiles(tenant)).toEqual(tenant);
  });

  it("returns the tenant profile unchanged when employee is empty", () => {
    const tenant: AwardProfileOverrides = {
      thresholds: { weeklyOrdinaryMinutes: 2400 },
      costPolicy: "max",
    };
    expect(mergeAwardProfiles(tenant, {})).toEqual(tenant);
  });

  it("employee fields win over tenant fields at the leaf level", () => {
    const tenant: AwardProfileOverrides = {
      thresholds: {
        dailyOrdinaryMinutes: 480,
        weeklyOrdinaryMinutes: 2280,
      },
      penaltyMultipliers: { sunday: 1.75 },
      costPolicy: "max",
    };
    const employee: AwardProfileOverrides = {
      thresholds: { weeklyOrdinaryMinutes: 2400 },
      penaltyMultipliers: { weekday: 1.1 },
      costPolicy: "stack",
    };
    expect(mergeAwardProfiles(tenant, employee)).toEqual({
      thresholds: {
        dailyOrdinaryMinutes: 480, // from tenant
        weeklyOrdinaryMinutes: 2400, // from employee (wins)
      },
      penaltyMultipliers: {
        sunday: 1.75, // from tenant
        weekday: 1.1, // from employee
      },
      costPolicy: "stack", // from employee (wins)
    });
  });

  it("preserves tenant values when employee sets only one leaf", () => {
    const tenant: AwardProfileOverrides = {
      penaltyMultipliers: { sunday: 1.75, saturday: 1.4 },
      overtimeMultiplier: 1.6,
    };
    const employee: AwardProfileOverrides = {
      penaltyMultipliers: { weekday: 1.1 },
    };
    const out = mergeAwardProfiles(tenant, employee);
    expect(out.penaltyMultipliers).toEqual({
      sunday: 1.75,
      saturday: 1.4,
      weekday: 1.1,
    });
    expect(out.overtimeMultiplier).toBe(1.6);
  });

  it("employee scalar overrides (OT multipliers, costPolicy) replace tenant scalars", () => {
    expect(
      mergeAwardProfiles(
        { overtimeMultiplier: 1.6 },
        { overtimeMultiplier: 2.0 },
      ),
    ).toEqual({ overtimeMultiplier: 2.0 });
  });

  it("returns an empty profile when both tenant and employee are empty", () => {
    expect(mergeAwardProfiles({}, {})).toEqual({});
  });
});

describe("classifyEmployeeWeek + computeAwardCost — tenant override end-to-end", () => {
  it("respects a custom weeklyOrdinaryMinutes from a tenant profile (40h instead of 38h)", () => {
    // Mon-Fri 9h each. Default 38h cap → 38 ord + 7 OT 1.5×.
    // Tenant raises cap to 40h → 40 ord + 5 OT 1.5× (no cascade beyond 40h).
    const breakdown = classifyEmployeeWeek(
      MON,
      [ms(9), ms(9), ms(9), ms(9), ms(9), 0, 0],
      new Set(),
      { weeklyOrdinaryMinutes: 40 * 60 },
    );
    expect(breakdown.totals.ordinaryMinutes).toBe(40 * 60);
    expect(breakdown.totals.overtimeMinutes).toBe(5 * 60);
  });

  it("respects a custom Sunday penalty multiplier (1.75×) on the cost output", () => {
    // 6h Sunday @ $30. Default sun = 1.5×; tenant override to 1.75×.
    //   ord = 6 × 30 × 1.75 = $315
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(6)], new Set());
    const cost = computeAwardCost(breakdown, 30, {
      penaltyMultipliers: resolvePenaltyMultipliers({ sunday: 1.75 }),
    });
    expect(roundCents(cost.totalCost)).toBe(315);
  });

  it("switches to 'stack' policy via override and gets the stacked Sun + OT cost", () => {
    // 9h Sunday @ $30 (default sun=1.5, OT=1.5):
    //   stack: ord = 8×30×1.5 = $360, ot = 1×30×(1.5×1.5) = $67.50. Total $427.50.
    const breakdown = classifyEmployeeWeek(MON, [0, 0, 0, 0, 0, 0, ms(9)], new Set());
    const cost = computeAwardCost(breakdown, 30, { policy: "stack" });
    expect(roundCents(cost.totalCost)).toBe(427.5);
  });
});
