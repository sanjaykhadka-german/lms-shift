import { describe, it, expect } from "vitest";
import { transformFwcPayload, type FwcAwardPayload } from "@tracey/award";

// Slice D: the pure MAPD transform. Uses a RECORDED sample payload (the
// documented shape) — no live network. When the real field names are
// confirmed against the FWC portal, update this fixture + the transform input
// interface together.

const SAMPLE: FwcAwardPayload = {
  code: "MA000059",
  name: "Meat Industry Award 2020",
  operativeFrom: "2025-07-01",
  ordinaryHoursPerWeek: 38,
  classifications: [
    {
      classificationName: "Level 1 — Entry",
      classificationLevel: "L1",
      baseHourlyRate: 25.0,
    },
    {
      // weekly rate only -> derived to hourly (988 / 38 = 26.00)
      classificationName: "Level 3 — Slaughterer",
      classificationLevel: "L3",
      baseWeeklyRate: 988,
    },
  ],
  wageAllowances: [
    { allowanceName: "Tool allowance", amount: 0.78, paymentFrequency: "Per hour" },
    { allowanceName: "Leading hand", amount: 30, paymentFrequency: "Per week" },
  ],
  expenseAllowances: [
    { allowanceName: "Meal allowance", amount: 15.5, paymentFrequency: "Per shift" },
  ],
};

describe("transformFwcPayload", () => {
  it("stamps the effective date and award name", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-19");
    expect(r.awardCode).toBe("MA000059");
    expect(r.awardName).toMatch(/meat/i);
    expect(r.effectiveFrom).toBe("2025-07-01");
  });

  it("maps classifications and derives hourly from a weekly rate", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-19");
    const l1 = r.classifications.find((c) => c.levelCode === "L1")!;
    const l3 = r.classifications.find((c) => c.levelCode === "L3")!;
    expect(l1.baseHourlyRate).toBe(25.0);
    expect(l3.baseHourlyRate).toBe(26.0); // 988 / 38
    expect(l3.label).toMatch(/slaughterer/i);
  });

  it("maps allowance payment frequency to type + taxability", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-19");
    const tool = r.allowances.find((a) => a.key === "tool_allowance")!;
    const leading = r.allowances.find((a) => a.key === "leading_hand")!;
    const meal = r.allowances.find((a) => a.key === "meal_allowance")!;
    expect(tool.type).toBe("per_hour");
    expect(tool.taxable).toBe(true); // wage-related
    expect(leading.type).toBe("flat"); // "Per week" -> flat
    expect(meal.type).toBe("per_shift");
    expect(meal.taxable).toBe(false); // expense allowance
  });

  it("falls back to asOf when no operativeFrom and skips rate-less classifications", () => {
    const r = transformFwcPayload(
      { code: "MA000059", classifications: [{ classificationName: "No rate" }] },
      "2026-06-19",
    );
    expect(r.effectiveFrom).toBe("2026-06-19");
    expect(r.classifications).toHaveLength(0);
  });
});
