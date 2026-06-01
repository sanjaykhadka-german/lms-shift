import { describe, it, expect } from "vitest";
import {
  mealBreakLevel,
  MEAL_BREAK_THRESHOLD_MS,
  MEAL_BREAK_WARN_LEAD_MS,
} from "../lib/meal-break";

const MIN = 60 * 1000;

describe("mealBreakLevel", () => {
  it("is 'ok' well before the threshold", () => {
    expect(mealBreakLevel(0)).toBe("ok");
    expect(mealBreakLevel(2 * 60 * MIN)).toBe("ok"); // 2h
  });

  it("flips to 'approaching' inside the warning lead window", () => {
    const justInside = MEAL_BREAK_THRESHOLD_MS - MEAL_BREAK_WARN_LEAD_MS + MIN;
    const justBefore = MEAL_BREAK_THRESHOLD_MS - MEAL_BREAK_WARN_LEAD_MS - MIN;
    expect(mealBreakLevel(justInside)).toBe("approaching");
    expect(mealBreakLevel(justBefore)).toBe("ok");
  });

  it("is 'approaching' exactly at the warn boundary", () => {
    const warnAt = MEAL_BREAK_THRESHOLD_MS - MEAL_BREAK_WARN_LEAD_MS;
    expect(mealBreakLevel(warnAt)).toBe("approaching");
  });

  it("is 'due' at and beyond the threshold", () => {
    expect(mealBreakLevel(MEAL_BREAK_THRESHOLD_MS)).toBe("due");
    expect(mealBreakLevel(MEAL_BREAK_THRESHOLD_MS + 60 * MIN)).toBe("due");
  });

  it("honours an injected custom threshold", () => {
    const fourHours = 4 * 60 * MIN;
    expect(mealBreakLevel(fourHours, fourHours)).toBe("due");
    expect(mealBreakLevel(fourHours - MIN, fourHours)).toBe("approaching");
    // A small custom threshold clamps the warn boundary at 0, so any
    // positive duration is at least "approaching", never negative-banded.
    expect(mealBreakLevel(0, 10 * MIN)).toBe("approaching");
  });
});
