import type { XeroExistingTimesheet, XeroTimesheetInput } from "./xero";

// Pure partition step for the reconcile-before-push export (see
// pushTimesheets). Given the timesheets we want in Xero for a week and the
// timesheets that already exist there, decide which to UPDATE in place and
// which to CREATE — the core duplicate / double-pay guard, kept SDK-free so
// it's unit-testable.
//
// An existing Xero timesheet matches when it's for the same employee AND its
// period start falls inside our week's window [weekStart, weekEnd]. Matching
// the window rather than string-equality on the exact Monday makes detection
// robust to the date normalisation drift that can come back from Xero's API
// (e.g. a UTC-parsed start landing a few hours off) — a miss there is what
// pushes the export down the create path and yields "this timesheet already
// exists". Weekly periods don't overlap, so the window can only ever contain
// this week's own timesheet. `weekEnd` defaults to `weekStart` (exact match)
// for callers that don't supply it. Anything without a match (including one
// deleted in Xero) is created fresh.

export interface ReconcilePlan {
  toUpdate: Array<{ input: XeroTimesheetInput; timesheetID: string }>;
  toCreate: XeroTimesheetInput[];
}

export function partitionForReconcile(
  timesheets: XeroTimesheetInput[],
  existing: XeroExistingTimesheet[],
  weekStart: string,
  weekEnd: string = weekStart,
): ReconcilePlan {
  const existingByEmp = new Map<string, XeroExistingTimesheet>();
  for (const e of existing) {
    // ISO YYYY-MM-DD compares correctly as a string.
    if (e.startDate && e.startDate >= weekStart && e.startDate <= weekEnd) {
      existingByEmp.set(e.employeeID, e);
    }
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
