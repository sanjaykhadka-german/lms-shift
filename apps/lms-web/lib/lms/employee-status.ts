export interface ActiveCheckUser {
  isActiveFlag: boolean | null;
  terminationDate: string | null;
}

export type EmployeeStatus = "active" | "disabled" | "terminated";

/** Classify an employee into one of three states.
 *  Priority: terminated > disabled > active.
 *  - Terminated: termination_date is set and already past (today is still "active").
 *  - Disabled:   is_active_flag = false; admin can re-activate at any time.
 *  - Active:     default. */
export function employeeStatus(u: ActiveCheckUser): EmployeeStatus {
  const today = new Date().toISOString().slice(0, 10);
  if (u.terminationDate && u.terminationDate < today) return "terminated";
  if (u.isActiveFlag === false) return "disabled";
  return "active";
}

/** True iff the employee is currently active. Thin wrapper over employeeStatus
 *  for the ~28 call sites that only care about the binary distinction. */
export function isEffectivelyActive(u: ActiveCheckUser): boolean {
  return employeeStatus(u) === "active";
}
