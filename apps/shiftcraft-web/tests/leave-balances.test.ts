import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scClockEvents: {},
  scEmployees: {},
  scLeaveTypes: {},
  scTimeOffRequests: {},
  scTimesheetApprovals: {},
}));

const {
  computeBalance,
  countBusinessDays,
  fmtHours,
  leaveDaysToHours,
  HOURS_PER_LEAVE_DAY_EXPORT,
} = await import("~/lib/leave-balances");

describe("HOURS_PER_LEAVE_DAY constant", () => {
  it("is 7.6 (AU full-time 38h ÷ 5 days)", () => {
    expect(HOURS_PER_LEAVE_DAY_EXPORT).toBe(7.6);
  });
});

describe("countBusinessDays", () => {
  it("counts a Monday-only range as 1", () => {
    // 2026-06-01 is a Monday
    expect(countBusinessDays("2026-06-01", "2026-06-01")).toBe(1);
  });

  it("counts Mon-Fri as 5", () => {
    expect(countBusinessDays("2026-06-01", "2026-06-05")).toBe(5);
  });

  it("excludes Saturday + Sunday", () => {
    // 2026-06-06 = Sat, 2026-06-07 = Sun
    expect(countBusinessDays("2026-06-06", "2026-06-07")).toBe(0);
  });

  it("counts a Mon-Mon week as 6 business days", () => {
    expect(countBusinessDays("2026-06-01", "2026-06-08")).toBe(6);
  });

  it("handles month boundaries", () => {
    // 2026-05-29 (Fri) → 2026-06-01 (Mon) = 2 business days (Fri + Mon)
    expect(countBusinessDays("2026-05-29", "2026-06-01")).toBe(2);
  });

  it("returns 0 for inverted range", () => {
    expect(countBusinessDays("2026-06-05", "2026-06-01")).toBe(0);
  });

  it("returns 0 for malformed input", () => {
    expect(countBusinessDays("not-a-date", "2026-06-01")).toBe(0);
  });
});

describe("computeBalance", () => {
  it("returns zero accrued for casual employees regardless of rate", () => {
    const r = computeBalance(200, 0.076923, 0, "casual");
    expect(r.accrued).toBe(0);
    expect(Math.abs(r.available)).toBe(0); // -0 / +0 normalised
  });

  it("returns zero accrued for labour_hire", () => {
    const r = computeBalance(200, 0.076923, 0, "labour_hire");
    expect(r.accrued).toBe(0);
  });

  it("returns zero accrued when rate is null (Unpaid type)", () => {
    const r = computeBalance(200, null, 5, "permanent");
    expect(r.accrued).toBe(0);
    expect(r.taken).toBe(5);
    expect(r.available).toBe(-5);
  });

  it("multiplies hours × rate for permanent employees with rate set", () => {
    // 200 ordinary hours × annual-leave rate ≈ 15.38h accrued
    const r = computeBalance(200, 0.076923, 0, "permanent");
    expect(r.accrued).toBeCloseTo(15.385, 2);
    expect(r.available).toBeCloseTo(15.385, 2);
  });

  it("subtracts taken hours from accrued", () => {
    const r = computeBalance(1000, 0.076923, 38, "permanent");
    // 1000 × 0.076923 = 76.923, − 38 = 38.923
    expect(r.accrued).toBeCloseTo(76.923, 2);
    expect(r.taken).toBe(38);
    expect(r.available).toBeCloseTo(38.923, 2);
  });

  it("can return a negative balance (informational; admins decide)", () => {
    const r = computeBalance(100, 0.076923, 50, "permanent");
    // 7.69 − 50 = -42.31
    expect(r.available).toBeLessThan(0);
  });
});

describe("leaveDaysToHours", () => {
  it("multiplies by 7.6 (AU full-time day length)", () => {
    expect(leaveDaysToHours(5)).toBeCloseTo(38, 2);
    expect(leaveDaysToHours(1)).toBeCloseTo(7.6, 2);
    expect(leaveDaysToHours(0)).toBe(0);
  });
});

describe("fmtHours", () => {
  it("returns Nh with no decimals when >= 10", () => {
    expect(fmtHours(15.385)).toBe("15h");
    expect(fmtHours(100)).toBe("100h");
  });

  it("returns N.Nh when < 10", () => {
    expect(fmtHours(0)).toBe("0.0h");
    expect(fmtHours(7.6)).toBe("7.6h");
    expect(fmtHours(-2.5)).toBe("-2.5h");
  });

  it("returns em-dash for non-finite", () => {
    expect(fmtHours(NaN)).toBe("—");
    expect(fmtHours(Infinity)).toBe("—");
  });
});
