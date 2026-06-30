import { describe, expect, it } from "vitest";
import {
  classifyWeek,
  DEFAULT_PENALTY_MULTIPLIERS,
  DEFAULT_THRESHOLDS,
  getPenaltyCategory,
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
      thresholds: {
        dailyOrdinaryMinutes: 456, // 7.6h
        dailyOvertimeMinutes: 576, // 9.6h
      },
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
      { thresholds: { weeklyOrdinaryMinutes: 40 * 60 } },
    );
    expect(out.totals.ordinaryMinutes).toBe(40 * 60);
    expect(out.totals.overtimeMinutes).toBe(5 * 60);
  });

  it("throws when dailyOvertimeMinutes < dailyOrdinaryMinutes (misconfig)", () => {
    expect(() =>
      classifyWeek([day("2026-05-26", 5)], {
        thresholds: {
          dailyOrdinaryMinutes: 600,
          dailyOvertimeMinutes: 480,
        },
      }),
    ).toThrow(/dailyOvertimeMinutes/);
  });

  it("echoes the resolved thresholds in the output", () => {
    const out = classifyWeek([day("2026-05-26", 5)], {
      thresholds: { weeklyOrdinaryMinutes: 40 * 60 },
    });
    expect(out.thresholds).toEqual({
      ...DEFAULT_THRESHOLDS,
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

describe("getPenaltyCategory", () => {
  // Reference dates (UTC parsing, no DST shift):
  //   2026-05-25 = Monday    (weekday)
  //   2026-05-30 = Saturday  (saturday)
  //   2026-05-31 = Sunday    (sunday)

  it("returns 'weekday' for Mon-Fri without a holiday", () => {
    expect(getPenaltyCategory("2026-05-25")).toBe("weekday");
    expect(getPenaltyCategory("2026-05-26")).toBe("weekday");
    expect(getPenaltyCategory("2026-05-29")).toBe("weekday");
  });

  it("returns 'saturday' for Saturday without a holiday", () => {
    expect(getPenaltyCategory("2026-05-30")).toBe("saturday");
  });

  it("returns 'sunday' for Sunday without a holiday", () => {
    expect(getPenaltyCategory("2026-05-31")).toBe("sunday");
  });

  it("returns 'public_holiday' when the date is in the holidayDates set", () => {
    const holidays = new Set(["2026-04-25"]);
    expect(getPenaltyCategory("2026-04-25", holidays)).toBe("public_holiday");
  });

  it("public-holiday status overrides weekend (Saturday holiday is 'public_holiday', not 'saturday')", () => {
    // 2026-04-25 = Saturday + ANZAC Day → public_holiday wins.
    const holidays = new Set(["2026-04-25"]);
    expect(getPenaltyCategory("2026-04-25", holidays)).toBe("public_holiday");
  });

  it("returns 'weekday' for a weekday not in the holiday set even when other dates are", () => {
    const holidays = new Set(["2026-04-25", "2026-12-25"]);
    expect(getPenaltyCategory("2026-05-26", holidays)).toBe("weekday");
  });

  it("throws on a malformed ISO date", () => {
    expect(() => getPenaltyCategory("not-a-date")).toThrow(/invalid date/);
  });
});

describe("classifyWeek — penaltyCategory tagging", () => {
  it("tags each day with the right category from day-of-week (no holidays)", () => {
    const out = classifyWeek([
      day("2026-05-25", 5), // Mon
      day("2026-05-30", 5), // Sat
      day("2026-05-31", 5), // Sun
    ]);
    expect(out.days.map((d) => d.penaltyCategory)).toEqual([
      "weekday",
      "saturday",
      "sunday",
    ]);
  });

  it("uses holidayDates to tag days as public_holiday, eclipsing weekend status", () => {
    const out = classifyWeek(
      [
        day("2026-04-24", 5), // Fri
        day("2026-04-25", 5), // Sat + ANZAC
        day("2026-04-26", 5), // Sun
      ],
      { holidayDates: new Set(["2026-04-25"]) },
    );
    expect(out.days.find((d) => d.date === "2026-04-25")!.penaltyCategory).toBe(
      "public_holiday",
    );
    expect(out.days.find((d) => d.date === "2026-04-24")!.penaltyCategory).toBe(
      "weekday",
    );
    expect(out.days.find((d) => d.date === "2026-04-26")!.penaltyCategory).toBe(
      "sunday",
    );
  });

  it("leaves penalty tagging independent of OT cascade — a Saturday over-cap day is still 'saturday'", () => {
    // Mon-Fri 8h each (40h ordinary day-pass) + Sat 4h → week cap kicks
    // in, but Sat's penaltyCategory stays "saturday" regardless.
    const out = classifyWeek([
      day("2026-05-25", 8),
      day("2026-05-26", 8),
      day("2026-05-27", 8),
      day("2026-05-28", 8),
      day("2026-05-29", 8),
      day("2026-05-30", 4),
    ]);
    const sat = out.days.find((d) => d.date === "2026-05-30")!;
    expect(sat.penaltyCategory).toBe("saturday");
    // Sanity: Saturday's ordinary got pushed to OT 1.5x by the weekly cap.
    expect(sat.ordinaryMinutes).toBe(0);
    expect(sat.overtimeMinutes).toBe(4 * 60);
  });
});

describe("classifyWeek — weekly overtime basis (38-hour week)", () => {
  // German Butchery runs MA000059 on a pure weekly basis: ordinary up to
  // 38h, the first 3h above that at OT 1.5x, the rest at OT 2x. Daily
  // length is irrelevant. These mirror the real test timesheets.
  const weekly = { overtimeBasis: "weekly" as const };

  it("Nasima: 43.04h week -> 38h ord + 3h OT1.5 + 2.04h OT2", () => {
    // Mon..Fri (9.40, 9.47, 10.32, 8.23, 5.62)h = 43.04h total.
    const out = classifyWeek(
      [
        day("2026-03-23", 9.4),
        day("2026-03-24", 9.47),
        day("2026-03-25", 10.32),
        day("2026-03-26", 8.23),
        day("2026-03-27", 5.62),
      ],
      { thresholds: weekly },
    );
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(3 * 60);
    // 43.04h - 41h = 2.04h = 122.4min -> rounds with the per-day inputs.
    expect(out.totals.doubleOvertimeMinutes).toBe(
      Math.round(43.04 * 60) - 41 * 60,
    );
    // No single day exceeds 10h-of-OT triggers — daily thresholds ignored.
  });

  it("Sandhya: 33.32h worked week -> all ordinary, no OT", () => {
    // Mon..Thu worked (8.73, 8.77, 7.62, 8.20); Fri is unpaid leave so it
    // never reaches the classifier (0 worked minutes here).
    const out = classifyWeek(
      [
        day("2026-03-16", 8.73),
        day("2026-03-17", 8.77),
        day("2026-03-18", 7.62),
        day("2026-03-19", 8.2),
        day("2026-03-20", 0),
      ],
      { thresholds: weekly },
    );
    expect(out.totals.ordinaryMinutes).toBe(Math.round(33.32 * 60));
    expect(out.totals.overtimeMinutes).toBe(0);
    expect(out.totals.doubleOvertimeMinutes).toBe(0);
  });

  it("a single 11h day stays all-ordinary when the week is under 38h", () => {
    // The daily basis would carve 8 ord + 2 OT1.5 + 1 OT2 from this day;
    // the weekly basis does not, because the week total is below 38h.
    const out = classifyWeek([day("2026-06-15", 11)], { thresholds: weekly });
    const d = out.days[0]!;
    expect(d.ordinaryMinutes).toBe(11 * 60);
    expect(d.overtimeMinutes).toBe(0);
    expect(d.doubleOvertimeMinutes).toBe(0);
  });

  it("honours a custom first-OT-tier width", () => {
    // 45h week, first-tier 2h: 38 ord + 2 OT1.5 + 5 OT2.
    const out = classifyWeek(
      [
        day("2026-06-15", 9),
        day("2026-06-16", 9),
        day("2026-06-17", 9),
        day("2026-06-18", 9),
        day("2026-06-19", 9),
      ],
      {
        thresholds: { overtimeBasis: "weekly", weeklyOvertimeFirstTierMinutes: 2 * 60 },
      },
    );
    expect(out.totals.ordinaryMinutes).toBe(38 * 60);
    expect(out.totals.overtimeMinutes).toBe(2 * 60);
    expect(out.totals.doubleOvertimeMinutes).toBe(5 * 60);
  });
});

describe("DEFAULT_PENALTY_MULTIPLIERS", () => {
  it("exposes general-rule AU defaults with holiday > sunday > saturday > weekday", () => {
    expect(DEFAULT_PENALTY_MULTIPLIERS.weekday).toBe(1.0);
    expect(DEFAULT_PENALTY_MULTIPLIERS.saturday).toBe(1.25);
    expect(DEFAULT_PENALTY_MULTIPLIERS.sunday).toBe(1.5);
    expect(DEFAULT_PENALTY_MULTIPLIERS.public_holiday).toBe(2.5);
    // Strict ordering — important for any "take max" consumer policy.
    const m = DEFAULT_PENALTY_MULTIPLIERS;
    expect(m.public_holiday).toBeGreaterThan(m.sunday);
    expect(m.sunday).toBeGreaterThan(m.saturday);
    expect(m.saturday).toBeGreaterThan(m.weekday);
  });
});
