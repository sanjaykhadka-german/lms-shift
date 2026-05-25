import "server-only";
import { and, asc, eq, gte, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  forTenant,
  scLeaveTypes,
  scLocations,
  scShiftAssignments,
  scShifts,
  scTimeOffRequests,
} from "@tracey/db";

// ─── Pure date math ──────────────────────────────────────────────────────
//
// Time-off requests use ISO date strings (no time-of-day) for [startDate,
// endDate]. To compare against shift timestamps we need to translate that
// into a [startOfStartDay, endOfEndDay) tz-naive window. Doing the
// translation in JS — rather than letting Postgres infer — keeps the
// query simpler and avoids subtle tz drift between the request's calendar
// dates (no offset) and the shift's tz-aware timestamps.

/** Convert YYYY-MM-DD into a local-tz Date at 00:00. */
export function startOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Convert YYYY-MM-DD into the next day's 00:00 (exclusive upper bound). */
export function endOfDayExclusive(iso: string): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d;
}

export interface AffectedShift {
  shiftId: string;
  startsAt: Date;
  endsAt: Date;
  role: string;
  locationName: string | null;
  status: "accepted" | "offered";
}

// ─── DB helper ───────────────────────────────────────────────────────────
//
// Lists the published (non-cancelled) shifts assigned to a user that
// overlap the calendar window [startDate, endDate]. Returns both
// accepted and offered shifts — admins want to know "if I approve this
// leave, what's the fallout?" and offers are part of that fallout (the
// employee can no longer accept them).
//
// Ordered by start time so the UI can render them as a chronological
// list without re-sorting.

export async function findAffectedShifts(
  tenantId: string,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<AffectedShift[]> {
  const rangeStart = startOfDay(startDate);
  const rangeEnd = endOfDayExclusive(endDate);

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        shiftId: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
        status: scShiftAssignments.status,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShiftAssignments.userId, userId),
          or(
            eq(scShiftAssignments.status, "accepted"),
            eq(scShiftAssignments.status, "offered"),
          ),
          eq(scShifts.traceyTenantId, tenantId),
          ne(scShifts.status, "cancelled"),
          gte(scShifts.endsAt, rangeStart),
          lt(scShifts.startsAt, rangeEnd),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );
  return rows as AffectedShift[];
}

// ─── Roster-clash guard (AUDIT.md #6) ────────────────────────────────────
//
// Reverse direction of findAffectedShifts: given a shift [startsAt, endsAt]
// window, list APPROVED time-off requests for a user that overlap. Used
// by the schedule action layer to block assigning / offering / claiming
// shifts to workers who are on approved leave.
//
// Why approved-only: a pending request is informational — the admin can
// still legitimately reject it, and rejecting after the shift has been
// assigned is the workflow we want. Approved is the bright-line state
// where rostering would create a contradiction.
//
// Returns the leave-type name + the date window so callers can show a
// useful error message ("On Annual leave 3 Jun → 7 Jun") rather than
// just a 422.

export interface LeaveConflict {
  requestId: string;
  startDate: string;
  endDate: string;
  leaveTypeName: string | null;
}

export async function findApprovedLeaveOverlap(
  tenantId: string,
  userId: string,
  shiftStartsAt: Date,
  shiftEndsAt: Date,
): Promise<LeaveConflict[]> {
  // Convert the shift's timestamptz window into ISO date strings for
  // comparison against the leave's start_date/end_date columns. Use
  // the shift's *local* calendar day boundaries — a shift starting at
  // 23:30 on Jun 3 conflicts with leave starting Jun 3, not just leave
  // that includes Jun 4. JS toISOString() emits UTC; the previous slice's
  // time-off-impact path handles this asymmetry by converting in JS, and
  // we follow that convention so semantics stay consistent.
  const shiftStartIso = isoDate(shiftStartsAt);
  const shiftEndIso = isoDate(shiftEndsAt);

  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        requestId: scTimeOffRequests.id,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
        leaveTypeName: scLeaveTypes.name,
      })
      .from(scTimeOffRequests)
      .leftJoin(
        scLeaveTypes,
        eq(scLeaveTypes.id, scTimeOffRequests.leaveTypeId),
      )
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.userId, userId),
          eq(scTimeOffRequests.status, "approved"),
          // Overlap: leave.start <= shift.end AND leave.end >= shift.start.
          lte(scTimeOffRequests.startDate, shiftEndIso),
          gte(scTimeOffRequests.endDate, shiftStartIso),
        ),
      ),
  );
  return rows as LeaveConflict[];
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in local time. Matches the form-input semantics for the
  // date columns (no tz applied).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Batch variant for bulk-offer: given a candidate user list and a
// single shift window, returns the subset of userIds with a conflict.
// One round-trip; the IN(...) lookup is cheap and lets the caller
// partition candidates into "offerable" and "skipped-due-to-leave"
// without N queries.

export async function findUsersWithLeaveConflict(
  tenantId: string,
  userIds: string[],
  shiftStartsAt: Date,
  shiftEndsAt: Date,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const shiftStartIso = isoDate(shiftStartsAt);
  const shiftEndIso = isoDate(shiftEndsAt);
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ userId: scTimeOffRequests.userId })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.status, "approved"),
          sql`${scTimeOffRequests.userId} = ANY(${userIds})`,
          lte(scTimeOffRequests.startDate, shiftEndIso),
          gte(scTimeOffRequests.endDate, shiftStartIso),
        ),
      ),
  );
  const conflicting = new Set<string>();
  for (const r of rows) conflicting.add(r.userId);
  return conflicting;
}

// ─── Batch helper ────────────────────────────────────────────────────────
//
// One round-trip variant for rendering an "impact" summary across a list
// of requests on the same page. Returns a Map keyed by requestId.

export async function findAffectedShiftsForRequests(
  tenantId: string,
  requests: Array<{ id: string; userId: string; startDate: string; endDate: string }>,
): Promise<Map<string, AffectedShift[]>> {
  const result = new Map<string, AffectedShift[]>();
  if (requests.length === 0) return result;
  // N round trips. Time-off pages are paginated/filtered to ~20 rows so
  // this is fine; if the page ever grows past ~50 pending we can switch
  // to a single CTE union — but the extra complexity isn't earning its
  // keep yet.
  await Promise.all(
    requests.map(async (r) => {
      const affected = await findAffectedShifts(
        tenantId,
        r.userId,
        r.startDate,
        r.endDate,
      );
      result.set(r.id, affected);
    }),
  );
  return result;
}
