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

  it("the preset's thresholds drive classifyWeek (11h day -> 8 ord + 2 OT + 1 dbl)", () => {
    const { thresholds } = AWARD_PRESETS.MA000059!.profile;
    const wk = classifyWeek([{ date: "2026-06-15", workedMinutes: 11 * 60 }], {
      thresholds,
    });
    const day = wk.days[0]!;
    expect(day.ordinaryMinutes).toBe(8 * 60);
    expect(day.overtimeMinutes).toBe(2 * 60);
    expect(day.doubleOvertimeMinutes).toBe(1 * 60);
  });

  it("listAwardPresets returns code + name pairs", () => {
    const list = listAwardPresets();
    expect(list.some((a) => a.code === "MA000059")).toBe(true);
  });
});
