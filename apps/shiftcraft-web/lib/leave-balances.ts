import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  forTenant,
  scClockEvents,
  scEmployees,
  scLeaveTypes,
  scTimeOffRequests,
  scTimesheetApprovals,
} from "@tracey/db";

// ─── Leave-balance computation (AUDIT.md Feature 6) ─────────────────
//
// Pure-ish: queries the DB once for each input set, then runs
// arithmetic. No mutations.
//
// Semantics (AU general-rule v1):
//   - accrued_hours = sum(ordinary hours from APPROVED weeks)
//                     × leave_type.accrual_rate_per_hour
//   - taken_hours   = sum(business-day-count × hours_per_day) from
//                     APPROVED time-off requests of this type
//   - available     = accrued - taken (can go negative — we surface
//                     a warning, don't block)
//
// Casual + labour_hire employees: accrued is always 0 (paid-leave
// loading is included in their hourly rate per AU general rule).
// They CAN still take unpaid leave; balance just stays 0 / negative.
//
// Hours per day: 7.6 (AU full-time standard — 38h/5d). Future tenants
// can override via the award profile; for v1 we hardcode.

const HOURS_PER_LEAVE_DAY = 7.6;
const CASUAL_TYPES = new Set(["casual", "labour_hire"]);

export interface LeaveBalance {
  leaveTypeId: string;
  slug: string;
  name: string;
  accrualRatePerHour: number | null;
  accruedHours: number;
  takenHours: number;
  availableHours: number;
}

/** Convert a [start, end] inclusive calendar-date range to business
 *  days. Saturday + Sunday counted as zero. Public-holiday-aware
 *  variant is a follow-up. */
export function countBusinessDays(startIso: string, endIso: string): number {
  // Parse as UTC midnight to avoid DST off-by-ones.
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  let count = 0;
  for (
    let d = new Date(start);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const dow = d.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/** Pure-math wrapper exposed for tests. */
export function computeBalance(
  ordinaryHoursWorked: number,
  rate: number | null,
  takenHours: number,
  employmentType: string,
): { accrued: number; taken: number; available: number } {
  if (rate == null || CASUAL_TYPES.has(employmentType)) {
    return { accrued: 0, taken: takenHours, available: -takenHours };
  }
  const accrued = ordinaryHoursWorked * rate;
  return {
    accrued,
    taken: takenHours,
    available: accrued - takenHours,
  };
}

export interface LeaveBalanceInputs {
  tenantId: string;
  employeeId: string;
}

export async function computeLeaveBalanceForEmployee(
  inputs: LeaveBalanceInputs,
): Promise<LeaveBalance[]> {
  const { tenantId, employeeId } = inputs;

  // 1. Employee row — need appUserId + employmentType.
  const [emp] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        appUserId: scEmployees.appUserId,
        employmentType: scEmployees.employmentType,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.id, employeeId),
          eq(scEmployees.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!emp) return [];

  // 2. Leave-type catalogue (all rows, including archived — we still
  //    want to surface balances on archived types that have rows).
  const types = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scLeaveTypes.id,
        slug: scLeaveTypes.slug,
        name: scLeaveTypes.name,
        accrualRatePerHour: scLeaveTypes.accrualRatePerHour,
      })
      .from(scLeaveTypes)
      .where(eq(scLeaveTypes.traceyTenantId, tenantId)),
  );
  if (types.length === 0) return [];

  // 3. Total ordinary hours worked from APPROVED timesheets. The
  //    classifier output lives in sc_timesheet_approvals.notes
  //    in v1's lightweight model — but the canonical source of
  //    truth is the clock event stream, classified at read time.
  //    For balance computation we approximate: sum (out - in)
  //    minutes for the employee, across weeks where there's an
  //    approval row. This deliberately doesn't try to split
  //    ordinary/OT — accrual policies typically use total hours
  //    not just ordinary; refinement is a v2 follow-up.
  //
  //    Cap at "weeks the manager has explicitly approved" so
  //    pending weeks don't inflate the balance.
  const ordinaryHoursWorked = emp.appUserId
    ? await computeApprovedHours(tenantId, emp.appUserId)
    : 0;

  // 4. Taken hours per leave type — sum business-days × hours-per-day
  //    across APPROVED time-off requests.
  const takenByType = await sumTakenHoursByType(
    tenantId,
    emp.appUserId,
  );

  return types
    .map((t) => {
      const rate = t.accrualRatePerHour ? Number(t.accrualRatePerHour) : null;
      const taken = takenByType.get(t.id) ?? 0;
      const { accrued, available } = computeBalance(
        ordinaryHoursWorked,
        rate,
        taken,
        emp.employmentType,
      );
      return {
        leaveTypeId: t.id,
        slug: t.slug,
        name: t.name,
        accrualRatePerHour: rate,
        accruedHours: accrued,
        takenHours: taken,
        availableHours: available,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// ─── Internals ──────────────────────────────────────────────────────

async function computeApprovedHours(
  tenantId: string,
  appUserId: string,
): Promise<number> {
  // Pull every approved week_start for this employee, plus the raw
  // clock stream. For each approved week, sum the in/out segments.
  // Cheap because approvals are sparse (one row per week per
  // employee).
  const [approvals, clockEvents] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          weekStart: scTimesheetApprovals.weekStart,
        })
        .from(scTimesheetApprovals)
        .where(
          and(
            eq(scTimesheetApprovals.traceyTenantId, tenantId),
            eq(scTimesheetApprovals.employeeUserId, appUserId),
            eq(scTimesheetApprovals.status, "approved"),
          ),
        ),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          eventType: scClockEvents.eventType,
          occurredAt: scClockEvents.occurredAt,
        })
        .from(scClockEvents)
        .where(
          and(
            eq(scClockEvents.traceyTenantId, tenantId),
            eq(scClockEvents.appUserId, appUserId),
          ),
        ),
    ),
  ]);

  if (approvals.length === 0 || clockEvents.length === 0) return 0;

  // Build the set of approved (week-start) ISO dates for O(1) lookup.
  const approvedWeeks = new Set(approvals.map((a) => a.weekStart));

  // Walk events chronologically, accumulate work segments. Add a
  // segment to the total when its starting clock-in falls within an
  // approved week.
  const sorted = [...clockEvents].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  let totalMinutes = 0;
  let openInAt: Date | null = null;
  for (const e of sorted) {
    if (e.eventType === "in" && !openInAt) {
      openInAt = e.occurredAt;
    } else if (
      (e.eventType === "out" || e.eventType === "break_start") &&
      openInAt
    ) {
      const weekStartIso = isoMonday(openInAt);
      if (approvedWeeks.has(weekStartIso)) {
        const min = Math.max(
          0,
          (e.occurredAt.getTime() - openInAt.getTime()) / 60_000,
        );
        totalMinutes += min;
      }
      openInAt = null;
    } else if (e.eventType === "break_end" && !openInAt) {
      openInAt = e.occurredAt;
    }
  }
  return totalMinutes / 60;
}

async function sumTakenHoursByType(
  tenantId: string,
  appUserId: string | null,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!appUserId) return out;
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        leaveTypeId: scTimeOffRequests.leaveTypeId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
      })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.userId, appUserId),
          eq(scTimeOffRequests.status, "approved"),
          isNotNull(scTimeOffRequests.leaveTypeId),
        ),
      ),
  );
  for (const r of rows) {
    if (!r.leaveTypeId) continue;
    const days = countBusinessDays(r.startDate, r.endDate);
    const hours = days * HOURS_PER_LEAVE_DAY;
    out.set(r.leaveTypeId, (out.get(r.leaveTypeId) ?? 0) + hours);
  }
  return out;
}

function isoMonday(d: Date): string {
  // Convert a Date to the ISO date of the Monday of its week
  // (Mon=0..Sun=6 in our local-day convention). Matches the keying
  // used by sc_timesheet_approvals.week_start.
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(monday.getDate() - day);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Format hours as `Nh` for tight displays, with one decimal when fractional. */
export function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (Math.abs(h) >= 10) return `${Math.round(h)}h`;
  return `${h.toFixed(1)}h`;
}

/** Convert a leave-day count → hours for the request-form pre-check. */
export function leaveDaysToHours(days: number): number {
  return days * HOURS_PER_LEAVE_DAY;
}

export const HOURS_PER_LEAVE_DAY_EXPORT = HOURS_PER_LEAVE_DAY;
