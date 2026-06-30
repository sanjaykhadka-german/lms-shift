import { describe, it, expect } from "vitest";
import {
  AWARD_PRESETS,
  getAwardPreset,
  listAwardPresets,
  classifyWeek,
} from "@tracey/award";

// Slice A: the MA000059 preset resolves the expected rule structure and feeds
// the classifier. (Dollar rates come from the FWC pull, not this preset.)

describe("award presets", () => {
  it("ships the Meat Industry Award (MA000059)", () => {
    const preset = getAwardPreset("MA000059");
    expect(preset).toBeDefined();
    expect(preset!.name).toMatch(/meat/i);
    expect(preset!.casualLoading).toBe(0.25);
  });

  it("MA000059 resolves the expected thresholds + multipliers", () => {
    const { profile } = AWARD_PRESETS.MA000059!;
    expect(profile.thresholds).toEqual({
      dailyOrdinaryMinutes: 480,
      dailyOvertimeMinutes: 600,
      weeklyOrdinaryMinutes: 2280,
      overtimeBasis: "weekly",
      weeklyOvertimeFirstTierMinutes: 180,
    });
    expect(profile.overtimeMultiplier).toBe(1.5);
    expect(profile.doubleOvertimeMultiplier).toBe(2.0);
    expect(profile.penaltyMultipliers).toMatchObject({
      weekday: 1.0,
      saturday: 1.5,
      sunday: 2.0,
      public_holiday: 2.5,
    });
    expect(profile.costPolicy).toBe("max");
  });

  it("the preset's thresholds drive classifyWeek on a weekly basis (45h week -> 38 ord + 3 OT1.5 + 4 OT2)", () => {
    const { thresholds } = AWARD_PRESETS.MA000059!.profile;
    // 5 x 9h = 45h. On the weekly basis the daily length is irrelevant:
    // 38h ordinary, the first 3h above at OT 1.5x, the remaining 4h at 2x.
    const wk = classifyWeek(
      [
        { date: "2026-06-15", workedMinutes: 9 * 60 },
        { date: "2026-06-16", workedMinutes: 9 * 60 },
        { date: "2026-06-17", workedMinutes: 9 * 60 },
        { date: "2026-06-18", workedMinutes: 9 * 60 },
        { date: "2026-06-19", workedMinutes: 9 * 60 },
      ],
      { thresholds },
    );
    expect(wk.totals.ordinaryMinutes).toBe(38 * 60);
    expect(wk.totals.overtimeMinutes).toBe(3 * 60);
    expect(wk.totals.doubleOvertimeMinutes).toBe(4 * 60);
  });

  it("listAwardPresets returns code + name pairs", () => {
    const list = listAwardPresets();
    expect(list.some((a) => a.code === "MA000059")).toBe(true);
  });
});
