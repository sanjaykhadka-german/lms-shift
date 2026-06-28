import type { XeroExistingTimesheet, XeroTimesheetInput } from "./xero";

// Pure partition step for the reconcile-before-push export (see
// pushTimesheets). Given the timesheets we want in Xero for a week and the
// timesheets that already exist there, decide which to UPDATE in place and
// which to CREATE — the core duplicate / double-pay guard, kept SDK-free so
// it's unit-testable.
//
// An existing Xero timesheet only matches when it's for the same employee AND
// its period starts on exactly our week's Monday, so we never touch an
// unrelated period. Anything without a match (including one that was deleted
// in Xero) is created fresh.

export interface ReconcilePlan {
  toUpdate: Array<{ input: XeroTimesheetInput; timesheetID: string }>;
  toCreate: XeroTimesheetInput[];
}

export function partitionForReconcile(
  timesheets: XeroTimesheetInput[],
  existing: XeroExistingTimesheet[],
  weekStart: string,
): ReconcilePlan {
  const existingByEmp = new Map<string, XeroExistingTimesheet>();
  for (const e of existing) {
    if (e.startDate === weekStart) existingByEmp.set(e.employeeID, e);
  }

  const toUpdate: ReconcilePlan["toUpdate"] = [];
  const toCreate: XeroTimesheetInput[] = [];
  for (const t of timesheets) {
    const ex = existingByEmp.get(t.xeroEmployeeId);
    if (ex) toUpdate.push({ input: t, timesheetID: ex.timesheetID });
    else toCreate.push(t);
  }
  return { toUpdate, toCreate };
}
