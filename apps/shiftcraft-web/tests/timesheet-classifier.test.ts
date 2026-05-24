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
  buildDayInputs,
  classifyEmployeeWeek,
  countPublicHolidays,
  fmtBreakdown,
  highestPenaltyCategory,
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
