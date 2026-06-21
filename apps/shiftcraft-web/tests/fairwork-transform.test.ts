import { describe, it, expect } from "vitest";
import { transformFwcPayload, type FwcAwardPayload } from "@tracey/award";

// Slice D: the pure MAPD transform. Uses a sample payload shaped like the REAL
// FWC MAPD API (snake_case rows, verified live 2026-06-21 against MA000059) —
// no live network. The client assembles these arrays from the paginated
// /awards/{fixed_id}/{pay-rates,wage-allowances,expense-allowances} endpoints.

const SAMPLE: FwcAwardPayload = {
  code: "MA000059",
  name: "Meat Industry Award 2020",
  payRates: [
    {
      classification_fixed_id: 2253,
      classification: "MI 1",
      classification_level: 1,
      base_rate: 922.7,
      base_rate_type: "Weekly",
      calculated_rate: 24.28,
      calculated_rate_type: "Hourly",
      employee_rate_type_code: "AD",
      operative_from: "2025-07-01",
      operative_to: null,
    },
    {
      classification_fixed_id: 2255,
      classification: "MI 3",
      classification_level: 3,
      base_rate: 988,
      base_rate_type: "Weekly",
      calculated_rate: 26.0,
      calculated_rate_type: "Hourly",
      employee_rate_type_code: "AD",
      operative_from: "2025-07-01",
      operative_to: null,
    },
    {
      // Junior rate for the same level — must be dropped (not "AD").
      classification_fixed_id: 2253,
      classification: "MI 1",
      classification_level: 1,
      calculated_rate: 12.14,
      calculated_rate_type: "Hourly",
      employee_rate_type_code: null,
      operative_from: "2025-07-01",
      operative_to: null,
    },
    {
      // Superseded adult rate — must be dropped (operative_to in the past).
      classification_fixed_id: 2253,
      classification: "MI 1",
      classification_level: 1,
      calculated_rate: 23.46,
      calculated_rate_type: "Hourly",
      employee_rate_type_code: "AD",
      operative_from: "2024-07-01",
      operative_to: "2025-06-30",
    },
  ],
  wageAllowances: [
    {
      allowance: "Cold temperature allowance—Below -16°C",
      allowance_amount: 1.27,
      payment_frequency: "per hour or part thereof unless stated otherwise",
      operative_from: "2025-07-01",
      operative_to: null,
    },
    {
      allowance: "Leading hand",
      allowance_amount: 30,
      payment_frequency: "per week",
      operative_from: "2025-07-01",
      operative_to: null,
    },
  ],
  expenseAllowances: [
    {
      allowance: "Meal allowance",
      allowance_amount: 15.5,
      payment_frequency: "per shift",
      operative_from: "2025-07-01",
      operative_to: null,
    },
  ],
};

describe("transformFwcPayload", () => {
  it("stamps the award name and derives the effective date from the rate-set", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-21");
    expect(r.awardCode).toBe("MA000059");
    expect(r.awardName).toMatch(/meat/i);
    expect(r.effectiveFrom).toBe("2025-07-01");
  });

  it("maps adult classifications and uses the calculated hourly rate", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-21");
    const mi1 = r.classifications.find((c) => c.levelCode === "MI1")!;
    const mi3 = r.classifications.find((c) => c.levelCode === "MI3")!;
    expect(mi1.baseHourlyRate).toBe(24.28);
    expect(mi1.label).toBe("MI 1");
    expect(mi3.baseHourlyRate).toBe(26.0);
  });

  it("drops junior (non-AD) and superseded (past operative_to) rates", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-21");
    // MI 1 collapses to a single current adult row, not the junior or the
    // 2024 rate.
    const mi1Rows = r.classifications.filter((c) => c.levelCode === "MI1");
    expect(mi1Rows).toHaveLength(1);
    expect(mi1Rows[0]!.baseHourlyRate).toBe(24.28);
    expect(r.classifications).toHaveLength(2);
  });

  it("maps allowance payment frequency to type + taxability", () => {
    const r = transformFwcPayload(SAMPLE, "2026-06-21");
    const cold = r.allowances.find((a) => a.key.startsWith("cold_temperature"))!;
    const leading = r.allowances.find((a) => a.key === "leading_hand")!;
    const meal = r.allowances.find((a) => a.key === "meal_allowance")!;
    expect(cold.type).toBe("per_hour");
    expect(cold.amount).toBe(1.27);
    expect(cold.taxable).toBe(true); // wage-related
    expect(leading.type).toBe("flat"); // "per week" -> flat
    expect(meal.type).toBe("per_shift");
    expect(meal.taxable).toBe(false); // expense allowance
  });

  it("falls back to asOf with no rows and skips rate-less classifications", () => {
    const r = transformFwcPayload(
      {
        code: "MA000059",
        payRates: [
          { classification: "No rate", employee_rate_type_code: "AD" },
        ],
      },
      "2026-06-21",
    );
    expect(r.effectiveFrom).toBe("2026-06-21");
    expect(r.classifications).toHaveLength(0);
  });
});
