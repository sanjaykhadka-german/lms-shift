import { describe, expect, it } from "vitest";
import {
  classifyWeek,
  DEFAULT_THRESHOLDS,
  type DayInput,
} from "@tracey/award";

// All inputs/outputs are integer minutes. Helpers below shorten the
// per-day input authoring so each case reads like a roster line.
function day(date: string, hours: number): DayInput {
  return { date, workedMinutes: Math.round(hours * 60) };
}

// Default thresholds from the package: 8h/10h/38h.
// Tests assert against minutes so changing the constants in the package
// would require updating defaults, not these specs.

describe("classifyWeek — empty input", () => {
  it("returns zero totals and no day rows for an empty week", () => {
    const out = classifyWeek([]);
    expect(out.days).toEqual([]);
    expect(out.totals).toEqual({
      workedMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      doubleOvertimeMinutes: 0,
    });
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("classifyWeek — single day (daily thresholds only)", () => {
  it("treats <= 8h as ordinary only", () => {
    const out = classifyWeek([day("2026-05-26", 7)]);
    expect(out.days[0]).toMatchObject({
      ordinaryMinutes: 420,
      overtimeMinutes: 0,
      doubleOvertimeMinutes: 0,
    });
  });

  it("splits 9h into 8h ordinary + 1h OT 1.5x", () => {
    const out = classifyWeek([day("2026-05-26", 9)]);
    expect(out.days[0]).toMatchObject({
      ordinaryMinutes: 8 * 60,
      overtimeMinutes: 1 * 60,
      doubleOvertimeMinutes: 0,
    });
  });

  it("caps OT 1.5x at the 8-10h band and pushes the rest to OT 2x", () => {
    // 12h = 8 ordinary + 2 OT1.5 + 2 OT2
    const out = classifyWeek([day("2026-05-26", 12)]);
    expect(out.days[0]).toMatchObject({
      ordinaryMinutes: 8 * 60,
      overtimeMinutes: 2 * 60,
      doubleOvertimeMinutes: 2 * 60,
    });
  });

  it("clamps negative worked minutes to zero", () => {
    const out = classifyWeek([
      { date: "2026-05-26", workedMinutes: -120 },
    ]);
    expect(out.days[0]).toMatchObject({
      workedMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      doubleOvertimeMinutes: 0,
    });
  });
});

describe("classifyWeek — weekly cascade", () => {
  it("leaves untouched when weekly ordinary sums to exactly the cap (38h)", () => {
    // Mon-Fri 7.6h each = 38h flat, all ordinary, no cascade.
    const out = classifyWeek([
      day("2026-05-25", 7.6),
      day("2026-05-26", 7.6),
      day("2026-05-27", 7.6),
      day("2026-05-28", 7.6),
      day("2026-05-29", 7.6),
    ]);
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(0);
    expect(out.totals.doubleOvertimeMinutes).toBe(0);
  });

  it("pushes weekly excess from the latest day's ordinary into OT 1.5x", () => {
    // Mon-Fri 9h each. Day-pass: 40h ordinary + 5h OT1.5.
    // Week cap is 38h, so 2h must move from the LAST day's ordinary
    // into OT1.5. Result: Mon-Thu 8/1, Fri 6/3.
    const out = classifyWeek([
      day("2026-05-25", 9),
      day("2026-05-26", 9),
      day("2026-05-27", 9),
      day("2026-05-28", 9),
      day("2026-05-29", 9),
    ]);
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(7 * 60);
    expect(out.totals.doubleOvertimeMinutes).toBe(0);
    expect(out.days[4]).toMatchObject({
      date: "2026-05-29",
      ordinaryMinutes: 6 * 60,
      overtimeMinutes: 3 * 60,
    });
    expect(out.days[3]).toMatchObject({
      date: "2026-05-28",
      ordinaryMinutes: 8 * 60,
      overtimeMinutes: 1 * 60,
    });
  });

  it("cascades the excess only into the day that tips the cap, not the prior days", () => {
    // Mon-Sat each 7h. Day-pass: 42h ordinary (no daily OT — all under
    // 8h). Week cap 38h → 4h surplus must move from Sat into OT1.5.
    const out = classifyWeek([
      day("2026-05-25", 7),
      day("2026-05-26", 7),
      day("2026-05-27", 7),
      day("2026-05-28", 7),
      day("2026-05-29", 7),
      day("2026-05-30", 7),
    ]);
    expect(out.days[5]).toMatchObject({
      date: "2026-05-30",
      ordinaryMinutes: 3 * 60,
      overtimeMinutes: 4 * 60,
    });
    // First five days untouched.
    for (let i = 0; i < 5; i++) {
      expect(out.days[i]!.ordinaryMinutes).toBe(7 * 60);
      expect(out.days[i]!.overtimeMinutes).toBe(0);
    }
  });

  it("does NOT cascade into the double-OT band even when weekly excess exists", () => {
    // Mon-Thu 9h each (32 ordinary + 4 OT1.5 day-pass).
    // Fri 12h (8 ord + 2 OT1.5 + 2 OT2 day-pass).
    // Day-pass week total: 40 ordinary + 6 OT1.5 + 2 OT2.
    // Week cap → 2h from Fri's ordinary moves to OT1.5.
    // Final: ordinary 38, OT1.5 = 6 + 2 = 8, OT2 = 2 (unchanged).
    const out = classifyWeek([
      day("2026-05-25", 9),
      day("2026-05-26", 9),
      day("2026-05-27", 9),
      day("2026-05-28", 9),
      day("2026-05-29", 12),
    ]);
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(8 * 60);
    expect(out.totals.doubleOvertimeMinutes).toBe(2 * 60);
  });
});

describe("classifyWeek — ordering + overrides", () => {
  it("returns day rows in ASC date order regardless of input order", () => {
    const out = classifyWeek([
      day("2026-05-29", 5),
      day("2026-05-25", 5),
      day("2026-05-27", 5),
    ]);
    expect(out.days.map((d) => d.date)).toEqual([
      "2026-05-25",
      "2026-05-27",
      "2026-05-29",
    ]);
  });

  it("honors a custom dailyOrdinaryMinutes threshold (7.6h award)", () => {
    // 7.6h ordinary cap, 9.6h before OT2.
    const out = classifyWeek([day("2026-05-26", 8)], {
      dailyOrdinaryMinutes: 456, // 7.6h
      dailyOvertimeMinutes: 576, // 9.6h
    });
    expect(out.days[0]).toMatchObject({
      ordinaryMinutes: 456,
      overtimeMinutes: (8 * 60) - 456,
      doubleOvertimeMinutes: 0,
    });
  });

  it("honors a custom weeklyOrdinaryMinutes threshold (e.g. 40h jurisdiction)", () => {
    // Mon-Fri 9h. Daily pass: 40 ord + 5 OT1.5. Weekly cap raised to 40h
    // → no cascade. Final: 40 ord + 5 OT1.5.
    const out = classifyWeek(
      [
        day("2026-05-25", 9),
        day("2026-05-26", 9),
        day("2026-05-27", 9),
        day("2026-05-28", 9),
        day("2026-05-29", 9),
      ],
      { weeklyOrdinaryMinutes: 40 * 60 },
    );
    expect(out.totals.ordinaryMinutes).toBe(40 * 60);
    expect(out.totals.overtimeMinutes).toBe(5 * 60);
  });

  it("throws when dailyOvertimeMinutes < dailyOrdinaryMinutes (misconfig)", () => {
    expect(() =>
      classifyWeek([day("2026-05-26", 5)], {
        dailyOrdinaryMinutes: 600,
        dailyOvertimeMinutes: 480,
      }),
    ).toThrow(/dailyOvertimeMinutes/);
  });

  it("echoes the resolved thresholds in the output", () => {
    const out = classifyWeek([day("2026-05-26", 5)], {
      weeklyOrdinaryMinutes: 40 * 60,
    });
    expect(out.thresholds).toEqual({
      dailyOrdinaryMinutes: DEFAULT_THRESHOLDS.dailyOrdinaryMinutes,
      dailyOvertimeMinutes: DEFAULT_THRESHOLDS.dailyOvertimeMinutes,
      weeklyOrdinaryMinutes: 40 * 60,
    });
  });
});

describe("classifyWeek — totals consistency", () => {
  it("totals always equal the sum of day rows", () => {
    const out = classifyWeek([
      day("2026-05-25", 9),
      day("2026-05-26", 11),
      day("2026-05-27", 5),
      day("2026-05-28", 0),
      day("2026-05-29", 8),
      day("2026-05-30", 6),
    ]);
    const sum = out.days.reduce(
      (acc, d) => ({
        workedMinutes: acc.workedMinutes + d.workedMinutes,
        ordinaryMinutes: acc.ordinaryMinutes + d.ordinaryMinutes,
        overtimeMinutes: acc.overtimeMinutes + d.overtimeMinutes,
        doubleOvertimeMinutes:
          acc.doubleOvertimeMinutes + d.doubleOvertimeMinutes,
      }),
      {
        workedMinutes: 0,
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        doubleOvertimeMinutes: 0,
      },
    );
    expect(out.totals).toEqual(sum);
  });

  it("workedMinutes per day = ordinary + overtime + doubleOvertime", () => {
    const out = classifyWeek([
      day("2026-05-25", 13),
      day("2026-05-26", 0),
      day("2026-05-27", 7.5),
    ]);
    for (const d of out.days) {
      expect(d.workedMinutes).toBe(
        d.ordinaryMinutes + d.overtimeMinutes + d.doubleOvertimeMinutes,
      );
    }
  });
});
