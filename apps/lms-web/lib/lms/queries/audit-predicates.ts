import { employeeStatus, type ActiveCheckUser } from "~/lib/lms/employee-status";

/** Pure predicates that mirror the SQL WHERE clauses applied by the
 *  per-resource query helpers when Audit Mode is on. Kept separate so
 *  they're trivial to unit-test without a live database. If you change
 *  one, change the corresponding SQL filter too — the data-access
 *  helpers (lib/lms/queries/*.ts) are the chokepoint, these are the
 *  truth function. */

export const auditModeKeepPublishedModule = (m: { isPublished: boolean | null }): boolean =>
  m.isPublished === true;

export const auditModeKeepCompletedAssignment = (a: {
  completedAt: Date | null;
}): boolean => a.completedAt !== null;

export const auditModeKeepPassedAttempt = (a: { passed: boolean | null }): boolean =>
  a.passed === true;

export const auditModeKeepActiveEmployee = (e: ActiveCheckUser): boolean =>
  employeeStatus(e) === "active";

/** WHS record with a future-or-no expiry survives audit mode. `today` is
 *  injected for tests; production calls leave it undefined to use real
 *  `new Date()` semantics. */
export function auditModeKeepUnexpiredWhs(
  w: { expiresOn: string | null },
  today: Date = new Date(),
): boolean {
  if (w.expiresOn === null) return true;
  const todayStr = today.toISOString().slice(0, 10);
  return w.expiresOn >= todayStr;
}
