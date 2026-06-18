import { describe, it, expect } from "vitest";
import { checkRateFloor } from "@tracey/award";

// Slice B: the minimum-rate floor check.

describe("checkRateFloor", () => {
  it("passes when at/above the minimum", () => {
    const r = checkRateFloor({
      hourlyRate: 30,
      baseHourlyRate: 26.55,
      casualLoading: 0.25,
      isCasual: false,
    });
    expect(r.ok).toBe(true);
    expect(r.minimum).toBe(26.55);
    expect(r.shortfall).toBe(0);
  });

  it("warns when below the permanent minimum", () => {
    const r = checkRateFloor({
      hourlyRate: 24,
      baseHourlyRate: 26.55,
      casualLoading: 0.25,
      isCasual: false,
    });
    expect(r.ok).toBe(false);
    expect(r.minimum).toBe(26.55);
    expect(r.shortfall).toBe(2.55);
  });

  it("applies casual loading to the minimum for casuals", () => {
    // base 26.55 × 1.25 = 33.1875 -> rounds to 33.19
    const r = checkRateFloor({
      hourlyRate: 30,
      baseHourlyRate: 26.55,
      casualLoading: 0.25,
      isCasual: true,
    });
    expect(r.minimum).toBe(33.19);
    expect(r.ok).toBe(false);
    expect(r.shortfall).toBe(3.19);
  });

  it("treats an exactly-equal rate as ok (no float noise)", () => {
    const r = checkRateFloor({
      hourlyRate: 26.55,
      baseHourlyRate: 26.55,
      casualLoading: null,
      isCasual: false,
    });
    expect(r.ok).toBe(true);
  });

  it("flags an unknown rate as not-ok but rateKnown=false (no shortfall)", () => {
    const r = checkRateFloor({
      hourlyRate: null,
      baseHourlyRate: 26.55,
      isCasual: false,
    });
    expect(r.ok).toBe(false);
    expect(r.rateKnown).toBe(false);
    expect(r.shortfall).toBe(0);
  });
});
