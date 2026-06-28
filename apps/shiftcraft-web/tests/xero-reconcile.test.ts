import { describe, it, expect } from "vitest";
import { partitionForReconcile } from "~/lib/payroll/reconcile";
import type { XeroExistingTimesheet, XeroTimesheetInput } from "~/lib/payroll/xero";

// Pure partition only imports types from xero.ts, so it loads here without the
// server-only / xero-node SDK runtime.

const WEEK = "2026-06-22";
const END = "2026-06-28";

function input(emp: string): XeroTimesheetInput {
  return {
    xeroEmployeeId: emp,
    startDate: WEEK,
    endDate: END,
    lines: [{ earningsRateId: "rate-ordinary", unitsByDay: [8, 8, 8, 8, 8, 0, 0] }],
  };
}

function existing(emp: string, startDate: string | null): XeroExistingTimesheet {
  return {
    timesheetID: `ts-${emp}`,
    employeeID: emp,
    startDate,
    endDate: END,
    status: "APPROVED",
  };
}

describe("partitionForReconcile", () => {
  it("updates the ones that already exist and creates the rest", () => {
    const plan = partitionForReconcile(
      [input("A"), input("B"), input("C")],
      [existing("A", WEEK), existing("C", WEEK)],
      WEEK,
    );
    expect(plan.toUpdate.map((u) => u.input.xeroEmployeeId)).toEqual(["A", "C"]);
    expect(plan.toUpdate.map((u) => u.timesheetID)).toEqual(["ts-A", "ts-C"]);
    expect(plan.toCreate.map((t) => t.xeroEmployeeId)).toEqual(["B"]);
  });

  it("recreates one that was deleted in Xero without touching the survivors (the reported bug)", () => {
    // Pushed A,B,C; B was deleted in Xero. Re-export should UPDATE A & C and
    // CREATE only B — no duplicates of A/C, B restored.
    const plan = partitionForReconcile(
      [input("A"), input("B"), input("C")],
      [existing("A", WEEK), existing("C", WEEK)],
      WEEK,
    );
    expect(plan.toCreate.map((t) => t.xeroEmployeeId)).toEqual(["B"]);
    expect(plan.toUpdate).toHaveLength(2);
  });

  it("creates everything on a first-ever export (nothing exists yet)", () => {
    const plan = partitionForReconcile([input("A"), input("B")], [], WEEK);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCreate.map((t) => t.xeroEmployeeId)).toEqual(["A", "B"]);
  });

  it("ignores a timesheet for a different period (never updates the wrong week)", () => {
    const plan = partitionForReconcile(
      [input("A")],
      [existing("A", "2026-06-15")], // previous week
      WEEK,
    );
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCreate.map((t) => t.xeroEmployeeId)).toEqual(["A"]);
  });

  it("ignores an existing row whose start date couldn't be parsed (null)", () => {
    const plan = partitionForReconcile([input("A")], [existing("A", null)], WEEK);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCreate).toHaveLength(1);
  });
});
