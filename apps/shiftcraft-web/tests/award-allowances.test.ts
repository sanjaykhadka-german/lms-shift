import { describe, it, expect } from "vitest";
import { computeAllowances } from "@tracey/award";

// Slice C: allowance computation by type.

const ctx = { workedHours: 38, shifts: 5, distinctDays: 5 };

describe("computeAllowances", () => {
  it("per_hour multiplies by worked hours", () => {
    const r = computeAllowances(
      [{ key: "meat_tool", label: "Tool", type: "per_hour", amount: 0.5 }],
      ctx,
    );
    expect(r.lines[0]!.units).toBe(38);
    expect(r.lines[0]!.value).toBe(19);
    expect(r.total).toBe(19);
  });

  it("flat applies once for a week with work", () => {
    const r = computeAllowances(
      [{ key: "laundry", label: "Laundry", type: "flat", amount: 12.5 }],
      ctx,
    );
    expect(r.lines[0]!.units).toBe(1);
    expect(r.lines[0]!.value).toBe(12.5);
  });

  it("per_shift and per_day use the right unit", () => {
    const r = computeAllowances(
      [
        { key: "meal", label: "Meal", type: "per_shift", amount: 3 },
        { key: "site", label: "Site", type: "per_day", amount: 4 },
      ],
      ctx,
    );
    expect(r.lines[0]!.value).toBe(15); // 3 × 5 shifts
    expect(r.lines[1]!.value).toBe(20); // 4 × 5 days
    expect(r.total).toBe(35);
  });

  it("flat does not apply when nothing was worked", () => {
    const r = computeAllowances(
      [{ key: "laundry", label: "Laundry", type: "flat", amount: 12.5 }],
      { workedHours: 0, shifts: 0, distinctDays: 0 },
    );
    expect(r.lines[0]!.units).toBe(0);
    expect(r.total).toBe(0);
  });

  it("defaults taxable to true and sums a mixed set", () => {
    const r = computeAllowances(
      [
        { key: "tool", label: "Tool", type: "per_hour", amount: 1 },
        { key: "laundry", label: "Laundry", type: "flat", amount: 10, taxable: false },
      ],
      ctx,
    );
    expect(r.lines[0]!.taxable).toBe(true);
    expect(r.lines[1]!.taxable).toBe(false);
    expect(r.total).toBe(48); // 38 + 10
  });
});
