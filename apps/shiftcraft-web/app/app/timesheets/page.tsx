import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  auditEvents,
  db,
  forTenant,
  members,
  scClockEventPhotos,
  scClockEvents,
  scDepartments,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scTimesheetApprovals,
  scTimesheetDayApprovals,
  scXeroEmployeeLinks,
  scXeroPayRuns,
  users,
  type ScTimesheetApprovalStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { canApproveTimesheets, isAtLeastManager, isLead } from "~/lib/roles";
import {
  getLeadAreaIds,
  getLeadTeamUserIds,
  getManagedLocationIds,
  resolveLeadAreas,
  scopeArray,
} from "~/lib/manager-scope";
import {
  addDays,
  fmtHours,
  fmtIsoDate,
  getEventsInRangeForTenant,
  getEventsInRangeForUser,
  parseIsoDate,
  startOfWeek,
} from "~/lib/clock";
import { getHolidaysForTenant } from "~/lib/holidays";
import {
  _parseAwardProfile,
  classifyEmployeeWeek,
  computeAwardCost,
  countPublicHolidays,
  fmtBreakdown,
  mergeAwardProfiles,
  resolvePenaltyMultipliers,
  roundCents,
  type AwardProfileOverrides,
} from "~/lib/timesheet-classifier";
import { getTenantAwardProfile } from "~/lib/award-profile";
import { TimesheetRow, type AnomalyFix } from "./_row";
import { BulkSelectionForm } from "./_bulk_form";
import { XeroRetryButton } from "./_xero-retry-button";
import { ApprovalDigestButton } from "./_digest-button";
import { ApprovalButtons } from "./_approval_buttons";
import { AddEntryForm } from "./_add_entry_form";
import { CloseStaleClockInsButton } from "./_close-stale-button";
import { maybeSweepStaleClockIns } from "./event-actions";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Timesheets · ShiftCraft" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type AnomalyKind =
  | "overtime_week"
  | "long_shift"
  | "no_clockout"
  | "no_show";

interface PerDayMeta {
  /** ISO YYYY-MM-DD for this column — the per-day approval action's target. */
  dayIso: string;
  /** Day is after today — render greyed, no value, not approvable. */
  isFuture: boolean;
  /** Day currently holds an open (still-clocked-in) segment. */
  isInProgress: boolean;
  /** Worked, clocked out, and not in the future — the only state where the
   *  day's shift counts as complete (and is per-day approvable). */
  isComplete: boolean;
  /** Rostered for a past day but no punches recorded — a per-day no-show. */
  noShow: boolean;
  /** Effective per-day approval: explicit day row, else inherited from the
   *  week-level status. null = pending. */
  approval: ScTimesheetApprovalStatus | null;
}

interface RowTotals {
  userId: string;
  name: string;
  email: string;
  /** workMs per day index 0..6 (Mon..Sun). */
  perDay: number[];
  /** Per-day display/gating metadata, Mon..Sun, length 7. */
  perDayMeta: PerDayMeta[];
  totalWorkMs: number;
  totalBreakMs: number;
  approvalStatus: ScTimesheetApprovalStatus | null;
  approvalNotes: string | null;
  approvedAtIso: string | null;
  approverName: string | null;
  /** Numeric cost in AUD (work hours × hourly_rate). null if rate not set. */
  costAud: number | null;
  /** Hourly rate in AUD (parsed numeric). null if rate not set. */
  hourlyRate: number | null;
  /** Pre-formatted per-day segment breakdown for the expansion row. Empty
   *  array on days with no events; outer length up to 7. */
  perDayDetail: PerDayDetailEntry[];
  /** Planned ms per day index 0..6 (Mon..Sun) from accepted shifts. */
  plannedDailyMs: number[];
  plannedTotalMs: number;
  anomalies: AnomalyKind[];
  /** One-click correction targets for the actionable anomalies above. */
  anomalyFixes: AnomalyFix[];
  /** AUDIT.md Phase 2 #3b.3 — pre-formatted classifier breakdown for the
   *  row's main line: "28h ord · 2h OT 1.5× · 1h OT 2×". Null when no
   *  worked minutes (matches the existing dash-style empty state). */
  awardBreakdownDisplay: string | null;
  /** Count of public-holiday days in this week per the tenant's holiday
   *  region. Drives a single chip in the row's anomaly area so managers
   *  see when penalty rates may apply. */
  publicHolidayCount: number;
  /** AUDIT.md Phase 2 #3b.4 — derived cost using OT bands × penalty
   *  multipliers under the "max" policy. Null when hourly_rate isn't
   *  set or there's no work (matches costAud's null semantics). */
  awardCostAud: number | null;
}

interface PerDayDetailEntry {
  /** Human label like "Mon 19 May". */
  dayLabel: string;
  /** ISO YYYY-MM-DD for the day — used by the "Add punch" modal's
   *  default datetime. */
  dayIso: string;
  /** Planned ms from sc_shift_assignments. 0 when nothing scheduled. */
  plannedMs: number;
  /** Sum of work-chunk ms for the day — saves the client doing math. */
  actualWorkMs: number;
  segments: Array<{
    kind: "work" | "break";
    label: string;
    sourceLabel: "Kiosk" | "Manual" | "Admin edit" | "Geofence";
    locationName: string | null;
    /** When present, the eventId is the clock event with a captured selfie.
     *  Used to build the /api/kiosk-selfie/<id> thumbnail src. */
    selfieEventId: string | null;
    /** scClockEvents.id of the event that OPENED this segment. The edit
     *  modal targets this id; on a void+insert the original is the row
     *  this id points to. */
    openingEventId: string;
    /** ISO 8601 of the original opening event's occurredAt — pre-fills
     *  the datetime-local input in the edit modal. */
    openingOccurredAtIso: string;
    /** Human label for the opening event ('Clock-in' etc.). */
    openingEventTypeLabel: string;
  }>;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  in: "Clock-in",
  out: "Clock-out",
  break_start: "Break start",
  break_end: "Break end",
};

const SOURCE_LABEL: Record<string, PerDayDetailEntry["segments"][number]["sourceLabel"]> = {
  kiosk: "Kiosk",
  manual: "Manual",
  admin_edit: "Admin edit",
  geofence: "Geofence",
};

function fmtClock(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const audFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 2,
});

function fmtAud(value: number | null): string {
  if (value == null) return "—";
  return audFormatter.format(value);
}

type StatusFilter =
  | "all"
  | "pending"
  | "approved"
  | "disputed"
  | "no_activity";

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "pending",
  "approved",
  "disputed",
  "no_activity",
];

function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (
    raw === "pending" ||
    raw === "approved" ||
    raw === "disputed" ||
    raw === "no_activity"
  ) {
    return raw;
  }
  return "all";
}

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    dept?: string;
    status?: string;
    digest?: string;
    range?: string;
  }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  // Capture the post-guard non-null user so the narrowing survives into the
  // nested buildWeekData() closure (TS drops control-flow narrowing across
  // function boundaries).
  const authUser = user;

  const role = membership.role;
  const tenantId = membership.tenant.id;

  // Auto clock-out anyone forgotten on the clock 24h+ after their scheduled
  // start (closed at the shift's scheduled end). Runs before the timesheet
  // queries below so any auto-closes show on this very render. Throttled to
  // once/hour per tenant and best-effort, so it never blocks the page.
  await maybeSweepStaleClockIns(tenantId);

  // `isAdmin` here means "manager — can manage timesheets" (approve, edit
  // punches, Xero, anomalies). Owners, admins, and Site Managers all
  // qualify. Site Managers are then narrowed to their own location(s)
  // via viewScope below. A Lead is NOT a manager (no editing) but CAN view +
  // approve — `canApprove` carries that, scoped to their area-team below.
  const isAdmin = isAtLeastManager(role);
  const canApprove = canApproveTimesheets(role);
  const isLeadRole = isLead(role);

  // Who can VIEW the team's timesheets (read-only is enough). On top of
  // managers, a non-manager employee may be granted can_view_timesheets,
  // which shows their own location's team in read-only mode.
  const [viewerEmp] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        locationId: scEmployees.locationId,
        canViewTimesheets: scEmployees.canViewTimesheets,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.appUserId, authUser.id),
        ),
      )
      .limit(1),
  );
  const grantedView = !isAdmin && (viewerEmp?.canViewTimesheets ?? false);
  // Leads are team viewers by role (scoped to their area-team, resolved in the
  // allMemberRows block below — an empty team simply shows nobody).
  const canViewTeam = isAdmin || grantedView || isLeadRole;

  // Location filter for scoped viewers (null = all locations). Owners/admins
  // see everyone; a Location Manager is bounded to their assigned sites; a
  // granted viewer to their own home location.
  let viewScope: string[] | null = null;
  if (role === "location_manager") {
    viewScope = scopeArray(await getManagedLocationIds(tenantId, authUser.id, role));
  } else if (grantedView) {
    viewScope = viewerEmp?.locationId ? [viewerEmp.locationId] : [];
  }

  const {
    week,
    dept,
    status: statusRaw,
    digest: digestRaw,
    range: rangeRaw,
  } = await searchParams;
  // R1 Features 3+4 — flash after the "email managers a summary" action.
  const digestCount = digestRaw == null ? null : Number.parseInt(digestRaw, 10);
  const deptFilter = dept ?? "";
  const statusFilter = parseStatusFilter(statusRaw);
  const weekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  // 1 WK / 2 WK range toggle (mirrors the schedule screen). 2 WK renders two
  // stacked week blocks; each block is still a 7-day grid, so the per-week
  // build (buildWeekData) runs once per week and the renderer maps over them.
  const range = rangeRaw === "2w" ? "2w" : "1w";
  const weekCount = range === "2w" ? 2 : 1;
  const weekStarts =
    weekCount === 2 ? [weekStart, addDays(weekStart, 7)] : [weekStart];
  // Prev/Today/Next step by the whole visible window so a 2 WK view pages a
  // fortnight at a time.
  const windowDays = weekCount * 7;
  const prevWeek = addDays(weekStart, -windowDays);
  const nextWeek = addDays(weekStart, windowDays);
  const windowEnd = addDays(weekStart, windowDays);

  // "Now" anchors two behaviours, computed once so every row shares one
  // reference point within a render: (1) an open (still-clocked-in) punch is
  // capped at now rather than the end of the week, and (2) days after today
  // render greyed and non-approvable. (todayIdx is per-week, so it's computed
  // inside buildWeekData below.)
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Build query-string preserving the active filters so week navigation
  // and the Clear button don't drop a selection. Pass `null` for an
  // override to deliberately clear that param.
  const qsFor = (overrides: {
    week?: string;
    dept?: string | null;
    status?: StatusFilter | null;
    range?: "1w" | "2w" | null;
  }) => {
    const params = new URLSearchParams();
    const w = overrides.week ?? (week ?? "");
    if (w) params.set("week", w);
    const d = overrides.dept === null ? "" : (overrides.dept ?? deptFilter);
    if (d) params.set("dept", d);
    const s =
      overrides.status === null
        ? "all"
        : (overrides.status ?? statusFilter);
    if (s && s !== "all") params.set("status", s);
    const r = overrides.range === null ? "1w" : (overrides.range ?? range);
    if (r && r !== "1w") params.set("range", r);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  // ─── Per-week pipeline ───────────────────────────────────────────────────
  // Everything below is scoped to a single [weekStart, weekStart+7) window:
  // events, approvals, planned-vs-actual, holidays, anomalies, the row set and
  // its summary. Wrapping it in buildWeekData means the 2 WK view is simply
  // "run it once per week"; every week-scoped concern (approvals keyed by
  // weekStart, the Xero pay-run, holidays) naturally scopes per block. The
  // tenant-wide queries inside re-run per week — acceptable on an admin page.
  async function buildWeekData(weekStart: Date) {
    const weekEnd = addDays(weekStart, 7);
    // Day index of today within THIS week: <0 future-only, >6 past-only,
    // else 0..6 (Mon..Sun). Drives greying + no-show gating.
    const todayIdx = Math.floor(
      (todayStart.getTime() - weekStart.getTime()) / 86_400_000,
    );

  // Resolve which users to show. Team viewers (managers + granted viewers):
  // everyone in the tenant, narrowed to viewScope's locations when scoped.
  // Everyone else: just themselves.
  let allMemberRows: Array<{
    userId: string;
    name: string | null;
    email: string;
  }>;
  if (canViewTeam) {
    const rows = await db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .where(eq(members.tenantId, tenantId));
    if (isLeadRole) {
      // A Lead sees only their area-team for the displayed week: employees
      // assigned to a shift in the Lead's area(s) during this week. No grants
      // (or no shifts) → nobody.
      const areaIds = await getLeadAreaIds(tenantId, authUser.id, role);
      const resolved = await resolveLeadAreas(tenantId, areaIds ?? new Set());
      const teamIds = await getLeadTeamUserIds(
        tenantId,
        resolved,
        weekStart,
        weekEnd,
      );
      allMemberRows = rows.filter((r) => teamIds.has(r.userId));
    } else if (viewScope === null) {
      allMemberRows = rows;
    } else {
      // Narrow to employees whose home location is in scope. An empty scope
      // (e.g. a Location Manager with no sites yet) shows nobody.
      const inScopeRows =
        viewScope.length === 0
          ? []
          : await forTenant(tenantId).run((tx) =>
              tx
                .select({ appUserId: scEmployees.appUserId })
                .from(scEmployees)
                .where(
                  and(
                    eq(scEmployees.traceyTenantId, tenantId),
                    isNotNull(scEmployees.appUserId),
                    inArray(scEmployees.locationId, viewScope!),
                  ),
                ),
            );
      const allowed = new Set(inScopeRows.map((r) => r.appUserId));
      allMemberRows = rows.filter((r) => allowed.has(r.userId));
    }
  } else {
    allMemberRows = [
      {
        userId: authUser.id,
        name: authUser.name,
        email: authUser.email,
      },
    ];
  }

  // Pull the auth-user → department mapping from the per-tenant sc_employees
  // table. Used both for the filter and for rendering the department name
  // alongside each row when a filter is active. Only admins ever need it.
  // Departments list is loaded for the dropdown options.
  const [scLinks, departments] = canViewTeam
    ? await forTenant(tenantId).run((tx) =>
        Promise.all([
          tx
            .select({
              empId: scEmployees.id,
              appUserId: scEmployees.appUserId,
              departmentId: scEmployees.departmentId,
              departmentName: scDepartments.name,
              hourlyRate: scEmployees.hourlyRate,
              awardProfile: scEmployees.awardProfile,
            })
            .from(scEmployees)
            .leftJoin(
              scDepartments,
              eq(scDepartments.id, scEmployees.departmentId),
            )
            .where(eq(scEmployees.traceyTenantId, tenantId)),
          tx
            .select({ id: scDepartments.id, name: scDepartments.name })
            .from(scDepartments)
            .where(eq(scDepartments.traceyTenantId, tenantId))
            .orderBy(asc(scDepartments.name)),
        ]),
      )
    : [[], []];

  const deptByUserId = new Map<
    string,
    {
      departmentId: string | null;
      departmentName: string | null;
      hourlyRate: number | null;
      awardProfile: AwardProfileOverrides;
    }
  >();
  // appUserId → sc_employees.id, for joining the displayed rows to the
  // Xero export ledger (which keys per-employee status by xero_employee_id).
  const empIdByUserId = new Map<string, string>();
  for (const link of scLinks) {
    if (link.appUserId) {
      empIdByUserId.set(link.appUserId, link.empId);
      // hourly_rate is numeric(10,2) which Drizzle returns as string. Parse
      // here so the row builder doesn't repeat the conversion per row.
      const rate =
        link.hourlyRate == null || link.hourlyRate === ""
          ? null
          : Number(link.hourlyRate);
      deptByUserId.set(link.appUserId, {
        departmentId: link.departmentId,
        departmentName: link.departmentName,
        hourlyRate: rate != null && Number.isFinite(rate) ? rate : null,
        // Phase 2 #3b.6 — per-employee award profile override. Run the
        // raw jsonb through the defensive parser so a stored shape from
        // a future schema version degrades to defaults rather than
        // crashing the row builder.
        awardProfile: _parseAwardProfile(link.awardProfile),
      });
    }
  }

  // ─── Per-employee Xero export status for the visible week (admin) ───
  // Reads the (tenant, week) pay-run ledger row and maps its per-employee
  // results (keyed by xero_employee_id) back to the rows shown here via
  // the employee-link table. Drives a small "Xero ✓ / ✗" chip per row.
  const xeroExportByUser = new Map<
    string,
    { state: "exported" | "failed"; detail: string | null }
  >();
  // R1 Feature 2 — drives the "Retry Xero export" affordance when the last
  // push for this week failed (whole-run failure or any per-employee rejection).
  let xeroFailed = false;
  let xeroLastError: string | null = null;
  if (isAdmin) {
    const wkIso = fmtIsoDate(weekStart);
    const [payRunRow] = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          status: scXeroPayRuns.status,
          lastError: scXeroPayRuns.lastError,
          summary: scXeroPayRuns.summary,
        })
        .from(scXeroPayRuns)
        .where(
          and(
            eq(scXeroPayRuns.traceyTenantId, tenantId),
            sql`${scXeroPayRuns.weekStart} = ${wkIso}::date`,
          ),
        )
        .limit(1),
    );
    const summary = (payRunRow?.summary ?? null) as {
      timesheets?: Array<{
        employeeId: string;
        timesheetId: string | null;
        error?: string | null;
      }>;
    } | null;
    const anyEmployeeError =
      summary?.timesheets?.some((t) => Boolean(t.error)) ?? false;
    xeroFailed = payRunRow?.status === "failed" || anyEmployeeError;
    xeroLastError =
      payRunRow?.lastError ??
      summary?.timesheets?.find((t) => t.error)?.error ??
      null;
    if (summary?.timesheets && summary.timesheets.length > 0) {
      const links = await forTenant(tenantId).run((tx) =>
        tx
          .select({
            scEmployeeId: scXeroEmployeeLinks.scEmployeeId,
            xeroEmployeeId: scXeroEmployeeLinks.xeroEmployeeId,
          })
          .from(scXeroEmployeeLinks)
          .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
      );
      const statusByXeroId = new Map<
        string,
        { state: "exported" | "failed"; detail: string | null }
      >();
      for (const t of summary.timesheets) {
        statusByXeroId.set(
          t.employeeId,
          t.error
            ? { state: "failed", detail: t.error }
            : t.timesheetId
              ? { state: "exported", detail: null }
              : { state: "failed", detail: "Xero returned no timesheet id" },
        );
      }
      const xeroByEmpId = new Map(
        links.map((l) => [l.scEmployeeId, l.xeroEmployeeId]),
      );
      for (const [uid, empId] of empIdByUserId) {
        const xeroId = xeroByEmpId.get(empId);
        if (!xeroId) continue;
        const st = statusByXeroId.get(xeroId);
        if (st) xeroExportByUser.set(uid, st);
      }
    }
  }

  // Apply the department filter (admin-only path; non-admins skip).
  const memberRows = isAdmin && deptFilter
    ? allMemberRows.filter((m) => {
        const link = deptByUserId.get(m.userId);
        if (deptFilter === "none") return !link?.departmentId;
        return link?.departmentId === deptFilter;
      })
    : allMemberRows;

  // Fetch events: one query for admin (whole tenant), one for self.
  const userIdSet = new Set(memberRows.map((m) => m.userId));
  const allEvents = canViewTeam
    ? await getEventsInRangeForTenant(tenantId, weekStart, weekEnd)
    : await getEventsInRangeForUser(tenantId, authUser.id, weekStart, weekEnd);

  const weekStartIso = fmtIsoDate(weekStart);
  const approvalRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeUserId: scTimesheetApprovals.employeeUserId,
        status: scTimesheetApprovals.status,
        notes: scTimesheetApprovals.notes,
        approvedAt: scTimesheetApprovals.approvedAt,
        approverId: scTimesheetApprovals.approvedByUserId,
        approverName: users.name,
        approverEmail: users.email,
      })
      .from(scTimesheetApprovals)
      .leftJoin(users, eq(users.id, scTimesheetApprovals.approvedByUserId))
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, tenantId),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      ),
  );
  const approvalByUser = new Map(
    approvalRows.map((r) => [
      r.employeeUserId,
      {
        status: r.status as ScTimesheetApprovalStatus,
        notes: r.notes,
        approvedAt: r.approvedAt,
        approverName: r.approverName ?? r.approverEmail ?? null,
      },
    ]),
  );

  // Per-day approvals for the visible week — keyed by "userId|YYYY-MM-DD". A day
  // with an explicit row wins; days without one inherit the week-level status
  // (so a plain whole-week approve shows every day green without materialising
  // seven rows). work_date is a date column → Drizzle returns "YYYY-MM-DD".
  const weekEndIso = fmtIsoDate(weekEnd);
  const dayApprovalRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeUserId: scTimesheetDayApprovals.employeeUserId,
        workDate: scTimesheetDayApprovals.workDate,
        status: scTimesheetDayApprovals.status,
      })
      .from(scTimesheetDayApprovals)
      .where(
        and(
          eq(scTimesheetDayApprovals.traceyTenantId, tenantId),
          sql`${scTimesheetDayApprovals.workDate} >= ${weekStartIso}::date`,
          sql`${scTimesheetDayApprovals.workDate} < ${weekEndIso}::date`,
        ),
      ),
  );
  const dayApprovalByUserDate = new Map(
    dayApprovalRows.map((r) => [
      `${r.employeeUserId}|${r.workDate}`,
      r.status as ScTimesheetApprovalStatus,
    ]),
  );

  // Activity log for the detail panel — only approve/dispute/reset events
  // for THIS week. Cheap query: targetKind narrows to ~tens of rows even
  // on big tenants, and the details->>'weekStart' filter scopes to this
  // week's slice. Grouped per-employee so the panel can render its own
  // timeline without another query.
  const activityRows = isAdmin
    ? await db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          actorEmail: auditEvents.actorEmail,
          actorName: users.name,
          createdAt: auditEvents.createdAt,
          details: auditEvents.details,
        })
        .from(auditEvents)
        .leftJoin(users, eq(users.id, auditEvents.actorUserId))
        .where(
          and(
            eq(auditEvents.tenantId, tenantId),
            eq(auditEvents.targetKind, "sc_timesheet_approval"),
            sql`(${auditEvents.details}->>'weekStart') = ${weekStartIso}`,
          ),
        )
        .orderBy(desc(auditEvents.createdAt))
    : [];

  const activityByUser = new Map<
    string,
    Array<{
      id: string;
      action: string;
      actor: string;
      occurredAtIso: string;
      notes: string | null;
    }>
  >();
  for (const a of activityRows) {
    const details = (a.details ?? {}) as Record<string, unknown>;
    const employeeUserId =
      typeof details.employeeUserId === "string"
        ? details.employeeUserId
        : null;
    if (!employeeUserId) continue;
    const notes =
      typeof details.notes === "string" && details.notes.length > 0
        ? details.notes
        : null;
    const arr = activityByUser.get(employeeUserId) ?? [];
    arr.push({
      id: a.id,
      action: a.action,
      actor: a.actorName ?? a.actorEmail ?? "system",
      occurredAtIso: a.createdAt.toISOString(),
      notes,
    });
    activityByUser.set(employeeUserId, arr);
  }

  // ─── Audit detail (locations, photos) + scheduled shifts for the week ───
  //
  // Admin-only because non-admin view is one row of self-data; planned vs
  // actual and selfies don't add anything there. Photos are filtered to
  // ('captured' AND event.id ∈ this week's events) so the network roundtrip
  // is bounded by the week's punch volume even on big tenants.
  const eventIdsThisWeek = allEvents.map((e) => e.id);
  const [locationRows, photoRows, acceptedShifts] = isAdmin
    ? await Promise.all([
        forTenant(tenantId).run((tx) =>
          tx
            .select({ id: scLocations.id, name: scLocations.name })
            .from(scLocations)
            .where(eq(scLocations.traceyTenantId, tenantId)),
        ),
        eventIdsThisWeek.length === 0
          ? Promise.resolve([] as Array<{ clockEventId: string }>)
          : forTenant(tenantId).run((tx) =>
              tx
                .select({ clockEventId: scClockEventPhotos.clockEventId })
                .from(scClockEventPhotos)
                .where(
                  and(
                    eq(scClockEventPhotos.traceyTenantId, tenantId),
                    eq(scClockEventPhotos.selfieStatus, "captured"),
                    inArray(scClockEventPhotos.clockEventId, eventIdsThisWeek),
                  ),
                ),
            ),
        forTenant(tenantId).run((tx) =>
          tx
            .select({
              userId: scShiftAssignments.userId,
              startsAt: scShifts.startsAt,
              endsAt: scShifts.endsAt,
            })
            .from(scShiftAssignments)
            .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
            .where(
              and(
                eq(scShiftAssignments.status, "accepted"),
                eq(scShifts.traceyTenantId, tenantId),
                gte(scShifts.startsAt, weekStart),
                lt(scShifts.startsAt, weekEnd),
              ),
            ),
        ),
      ])
    : [[], [], []];

  const locationNameById = new Map(
    locationRows.map((l) => [l.id, l.name] as const),
  );
  const selfieEventIds = new Set(photoRows.map((r) => r.clockEventId));

  // Aggregate planned ms per (userId, dayIdx). Splits each shift at midnight
  // the same way splitSegmentByDay does for actual punches so the comparison
  // is apples-to-apples per calendar day.
  const plannedByUser = new Map<string, number[]>();
  for (const s of acceptedShifts) {
    if (!userIdSet.has(s.userId)) continue;
    const arr =
      plannedByUser.get(s.userId) ?? Array.from({ length: 7 }, () => 0);
    let cursor = s.startsAt;
    while (cursor < s.endsAt) {
      const dayBoundary = new Date(cursor);
      dayBoundary.setHours(0, 0, 0, 0);
      dayBoundary.setDate(dayBoundary.getDate() + 1);
      const chunkEnd = dayBoundary < s.endsAt ? dayBoundary : s.endsAt;
      const dayIdx = Math.floor(
        (cursor.getTime() - weekStart.getTime()) / 86_400_000,
      );
      if (dayIdx >= 0 && dayIdx <= 6) {
        arr[dayIdx]! += chunkEnd.getTime() - cursor.getTime();
      }
      cursor = chunkEnd;
    }
    plannedByUser.set(s.userId, arr);
  }

  // Group events by user, then compute per-day work ms.
  const byUser = new Map<string, typeof allEvents>();
  for (const e of allEvents) {
    if (!userIdSet.has(e.appUserId)) continue;
    const arr = byUser.get(e.appUserId) ?? [];
    arr.push(e);
    byUser.set(e.appUserId, arr);
  }

  // AUDIT.md Phase 2 #3b.3 — fetch the tenant's holiday calendar for the
  // visible week once. weekEnd is exclusive in the surrounding code; the
  // holiday range is inclusive on both ends so we ask for [weekStart,
  // weekEnd - 1 day]. Empty when the tenant hasn't picked a region yet
  // (lazy default "national" handled by the helper).
  const lastDayIso = fmtIsoDate(addDays(weekEnd, -1));
  const [weekHolidays, awardProfile] = await Promise.all([
    getHolidaysForTenant(tenantId, fmtIsoDate(weekStart), lastDayIso),
    getTenantAwardProfile(tenantId),
  ]);
  const holidayDates = new Set(weekHolidays.map((h) => h.date));

  const rows: RowTotals[] = memberRows.map((m) => {
    const userEvents = byUser.get(m.userId) ?? [];
    // Walk events directly so each derived segment carries the originating
    // event's id / source / locationId — needed by the expansion to render
    // source chip + location chip + selfie thumbnail next to each chunk.
    interface SegMeta {
      kind: "work" | "break";
      startedAt: Date;
      endedAt: Date;
      openingEventId: string;
      openingSource: string;
      openingLocationId: string | null;
      openingEventType: string;
      // The event that CLOSED this segment (break_end for a break, out/
      // break_start for work). Null when force-closed at week-end. Used to
      // make a break's end editable inline (item 5).
      closingEventId: string | null;
      closingOccurredAt: Date | null;
    }
    const segs: SegMeta[] = [];
    let open: {
      kind: "work" | "break";
      startedAt: Date;
      eventId: string;
      source: string;
      locationId: string | null;
      eventType: string;
    } | null = null;
    const closeOpen = (
      endedAt: Date,
      closingEvent: { id: string; occurredAt: Date } | null,
    ) => {
      if (!open) return;
      if (endedAt > open.startedAt) {
        segs.push({
          kind: open.kind,
          startedAt: open.startedAt,
          endedAt,
          openingEventId: open.eventId,
          openingSource: open.source,
          openingLocationId: open.locationId,
          openingEventType: open.eventType,
          closingEventId: closingEvent?.id ?? null,
          closingOccurredAt: closingEvent?.occurredAt ?? null,
        });
      }
      open = null;
    };
    for (const e of userEvents) {
      switch (e.eventType) {
        case "in":
          if (!open) {
            open = {
              kind: "work",
              startedAt: e.occurredAt,
              eventId: e.id,
              source: e.source,
              locationId: e.locationId,
              eventType: e.eventType,
            };
          }
          break;
        case "break_start":
          if (open?.kind === "work") {
            closeOpen(e.occurredAt, { id: e.id, occurredAt: e.occurredAt });
            open = {
              kind: "break",
              startedAt: e.occurredAt,
              eventId: e.id,
              source: e.source,
              locationId: e.locationId,
              eventType: e.eventType,
            };
          }
          break;
        case "break_end":
          if (open?.kind === "break") {
            closeOpen(e.occurredAt, { id: e.id, occurredAt: e.occurredAt });
            open = {
              kind: "work",
              startedAt: e.occurredAt,
              eventId: e.id,
              source: e.source,
              locationId: e.locationId,
              eventType: e.eventType,
            };
          }
          break;
        case "out":
          closeOpen(e.occurredAt, { id: e.id, occurredAt: e.occurredAt });
          break;
        default:
          break;
      }
    }
    // Track whether the user was left open at week-end (anomaly signal)
    // BEFORE force-closing for the aggregation. Capture the open punch's day
    // too — that's where the missing clock-out belongs (the "Fix" target).
    const hadOpenAtWeekEnd = open !== null;
    const openPunchDayIso = open ? fmtIsoDate(open.startedAt) : null;
    // An open punch (clocked in, never out) is capped at "now", not the end of
    // the week. Force-closing at weekEnd smeared a single open segment across
    // every remaining day — dumping ~24h onto each, including future Sat/Sun.
    // Capping at now contributes only real elapsed time; future days stay 0.
    // The day that holds the cap is the in-progress day, surfaced so the row
    // can show live-so-far + an "In progress" pill and suppress its approve.
    let openSegmentDayIdx: number | null = null;
    if (open) {
      const cap = now < weekEnd ? now : weekEnd;
      const capIdx = Math.floor(
        (cap.getTime() - weekStart.getTime()) / 86_400_000,
      );
      openSegmentDayIdx = capIdx >= 0 && capIdx <= 6 ? capIdx : null;
      closeOpen(cap, null);
    }

    const perDay = Array.from({ length: 7 }, () => 0);
    // chunksByDay carries metadata; one entry per (segment × day-split).
    const chunksByDay: Array<
      Array<{
        kind: "work" | "break";
        startedAt: Date;
        endedAt: Date;
        openingEventId: string;
        openingSource: string;
        openingLocationId: string | null;
        openingEventType: string;
        openingOccurredAt: Date;
        closingEventId: string | null;
        closingOccurredAt: Date | null;
      }>
    > = Array.from({ length: 7 }, () => []);
    let totalWork = 0;
    let totalBreak = 0;
    for (const seg of segs) {
      // Split this segment at midnight using the same logic as
      // splitSegmentByDay, but carry the opening-event metadata onto
      // each resulting day chunk.
      let cursor = seg.startedAt;
      while (cursor < seg.endedAt) {
        const dayBoundary = new Date(cursor);
        dayBoundary.setHours(0, 0, 0, 0);
        dayBoundary.setDate(dayBoundary.getDate() + 1);
        const chunkEnd =
          dayBoundary < seg.endedAt ? dayBoundary : seg.endedAt;
        const dayIdx = Math.floor(
          (cursor.getTime() - weekStart.getTime()) / 86_400_000,
        );
        if (dayIdx >= 0 && dayIdx <= 6) {
          const ms = chunkEnd.getTime() - cursor.getTime();
          if (seg.kind === "work") {
            perDay[dayIdx]! += ms;
            totalWork += ms;
          } else {
            totalBreak += ms;
          }
          chunksByDay[dayIdx]!.push({
            kind: seg.kind,
            startedAt: cursor,
            endedAt: chunkEnd,
            openingEventId: seg.openingEventId,
            openingSource: seg.openingSource,
            openingLocationId: seg.openingLocationId,
            openingEventType: seg.openingEventType,
            openingOccurredAt: seg.startedAt,
            closingEventId: seg.closingEventId,
            closingOccurredAt: seg.closingOccurredAt,
          });
        }
        cursor = chunkEnd;
      }
    }

    // Pre-format the per-day expansion content server-side so the client
    // row component stays free of server-only imports + date math.
    const planned = plannedByUser.get(m.userId) ?? Array.from({ length: 7 }, () => 0);
    const perDayDetail: PerDayDetailEntry[] = [];
    for (let dayIdx = 0; dayIdx < 7; dayIdx += 1) {
      const dayChunks = chunksByDay[dayIdx]!;
      const plannedMs = planned[dayIdx]!;
      // Skip days with no actual punches AND no planned shift — keeps the
      // expansion focused. Days with planned-but-no-actual still surface
      // so managers can spot no-shows in the breakdown.
      if (dayChunks.length === 0 && plannedMs === 0) continue;
      dayChunks.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
      const dayDate = addDays(weekStart, dayIdx);
      const actualWorkMs = dayChunks
        .filter((c) => c.kind === "work")
        .reduce((sum, c) => sum + (c.endedAt.getTime() - c.startedAt.getTime()), 0);
      perDayDetail.push({
        dayLabel: dayDate.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
        dayIso: fmtIsoDate(dayDate),
        plannedMs,
        actualWorkMs,
        segments: dayChunks.map((c) => ({
          kind: c.kind,
          label: `${fmtClock(c.startedAt)}–${fmtClock(c.endedAt)} (${fmtHours(c.endedAt.getTime() - c.startedAt.getTime())})`,
          sourceLabel: SOURCE_LABEL[c.openingSource] ?? "Manual",
          locationName: c.openingLocationId
            ? (locationNameById.get(c.openingLocationId) ?? null)
            : null,
          selfieEventId:
            c.kind === "work" && selfieEventIds.has(c.openingEventId)
              ? c.openingEventId
              : null,
          openingEventId: c.openingEventId,
          openingOccurredAtIso: c.openingOccurredAt.toISOString(),
          openingEventTypeLabel:
            EVENT_TYPE_LABEL[c.openingEventType] ?? c.openingEventType,
          // Closing event: a break's break_end (edited inline, item 5) and a
          // work segment's out (used to prefill the clock-out in the whole-day
          // editor). Null when the segment was force-closed at week-end / open.
          closingEventId: c.closingEventId,
          closingOccurredAtIso: c.closingOccurredAt
            ? c.closingOccurredAt.toISOString()
            : null,
        })),
      });
    }

    const plannedTotalMs = planned.reduce((sum, ms) => sum + ms, 0);

    // Per-day display/gating metadata. Drives greying of future days, the
    // in-progress pill, per-day no-show chips, and approval gating (#4). A day
    // is future when its index is past today's; no-show is only asserted for
    // days strictly before today (today's rostered shift may not have started
    // yet, so it isn't a no-show until the day has passed).
    const weekStatusForRow = approvalByUser.get(m.userId)?.status ?? null;
    const perDayMeta: PerDayMeta[] = Array.from({ length: 7 }, (_, i) => {
      const dayIso = fmtIsoDate(addDays(weekStart, i));
      const isFuture = i > todayIdx;
      const isPast = i < todayIdx;
      const isInProgress = openSegmentDayIdx === i;
      const worked = (perDay[i] ?? 0) > 0;
      // Explicit per-day row wins; otherwise inherit the week-level status.
      const approval =
        dayApprovalByUserDate.get(`${m.userId}|${dayIso}`) ?? weekStatusForRow;
      return {
        dayIso,
        isFuture,
        isInProgress,
        isComplete: worked && !isInProgress && !isFuture,
        noShow: isPast && (planned[i] ?? 0) > 0 && (perDay[i] ?? 0) === 0,
        approval,
      };
    });

    // Anomaly derivation — pure functions of the totals above.
    const anomalies: AnomalyKind[] = [];
    if (totalWork > 40 * 3_600_000) anomalies.push("overtime_week");
    if (perDay.some((ms) => ms > 10 * 3_600_000)) anomalies.push("long_shift");
    if (hadOpenAtWeekEnd) anomalies.push("no_clockout");
    if (plannedTotalMs > 0 && totalWork === 0) anomalies.push("no_show");

    // One-click fix targets for the actionable anomalies. no_clockout → add the
    // missing clock-out on the open punch's day; no_show → add a clock-in on the
    // first day that was rostered but had no work.
    const anomalyFixes: AnomalyFix[] = [];
    if (hadOpenAtWeekEnd && openPunchDayIso) {
      anomalyFixes.push({
        kind: "no_clockout",
        dayIso: openPunchDayIso,
        eventType: "out",
      });
    }
    if (plannedTotalMs > 0 && totalWork === 0) {
      const missingDayIdx = planned.findIndex((ms, i) => ms > 0 && perDay[i] === 0);
      if (missingDayIdx >= 0) {
        anomalyFixes.push({
          kind: "no_show",
          dayIso: fmtIsoDate(addDays(weekStart, missingDayIdx)),
          eventType: "in",
        });
      }
    }

    const approval = approvalByUser.get(m.userId);
    const rate = deptByUserId.get(m.userId)?.hourlyRate ?? null;
    const costAud =
      rate != null && totalWork > 0
        ? Math.round((rate * (totalWork / 3_600_000)) * 100) / 100
        : null;

    // AUDIT.md Phase 2 #3b.3 / #3b.5 / #3b.6 — classify this employee's
    // worked minutes. The resolution chain is employee profile →
    // tenant profile → @tracey/award defaults, merged per leaf field.
    const effectiveProfile = mergeAwardProfiles(
      awardProfile,
      deptByUserId.get(m.userId)?.awardProfile,
    );
    const breakdown = classifyEmployeeWeek(
      weekStart,
      perDay,
      holidayDates,
      effectiveProfile.thresholds,
    );
    // AUDIT.md Phase 2 #3b.4 — derived cost using OT × penalty.
    // Multipliers + policy come from the merged effective profile.
    // Null when rate isn't set OR no work — the simple flat `costAud`
    // line uses the same null semantics so both cost lines either show
    // or dash together.
    const awardCostAud =
      rate != null && totalWork > 0
        ? roundCents(
            computeAwardCost(breakdown, rate, {
              policy: effectiveProfile.costPolicy,
              penaltyMultipliers: resolvePenaltyMultipliers(
                effectiveProfile.penaltyMultipliers,
              ),
              overtimeMultiplier: effectiveProfile.overtimeMultiplier,
              doubleOvertimeMultiplier:
                effectiveProfile.doubleOvertimeMultiplier,
            }).totalCost,
          )
        : null;

    return {
      userId: m.userId,
      name: m.name ?? m.email,
      email: m.email,
      perDay,
      totalWorkMs: totalWork,
      totalBreakMs: totalBreak,
      approvalStatus: approval?.status ?? null,
      approvalNotes: approval?.notes ?? null,
      approvedAtIso: approval?.approvedAt?.toISOString() ?? null,
      approverName: approval?.approverName ?? null,
      costAud,
      hourlyRate: rate,
      perDayDetail,
      perDayMeta,
      plannedDailyMs: planned,
      plannedTotalMs,
      anomalies,
      anomalyFixes,
      awardBreakdownDisplay: fmtBreakdown(breakdown),
      publicHolidayCount: countPublicHolidays(breakdown),
      awardCostAud,
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Counts for the status filter pills. Computed on the post-dept-filter
  // set so each pill's number is meaningful inside the current slice.
  // "all" matches the legacy default (admins see everyone; non-admins
  // see themselves regardless of activity).
  function rowMatches(r: RowTotals, status: StatusFilter): boolean {
    const hasActivity = r.totalWorkMs > 0 || r.totalBreakMs > 0;
    switch (status) {
      case "pending":
        return r.approvalStatus === null && hasActivity;
      case "approved":
        return r.approvalStatus === "approved";
      case "disputed":
        return r.approvalStatus === "disputed";
      case "no_activity":
        return !hasActivity;
      case "all":
      default:
        return hasActivity || canViewTeam;
    }
  }
  const statusCounts: Record<StatusFilter, number> = {
    all: rows.filter((r) => rowMatches(r, "all")).length,
    pending: rows.filter((r) => rowMatches(r, "pending")).length,
    approved: rows.filter((r) => rowMatches(r, "approved")).length,
    disputed: rows.filter((r) => rowMatches(r, "disputed")).length,
    no_activity: rows.filter((r) => rowMatches(r, "no_activity")).length,
  };

  const visibleRows = rows.filter((r) => rowMatches(r, statusFilter));

  // R1 Feature 1 — one-click "approve all pending in this view" (e.g. all of
  // Dispatch this week). Pending = worked-but-unapproved, taken across the
  // whole dept-filtered / in-scope set (not just the active status pill).
  // Admin-only; bulkApproveAction re-gates on the server.
  const pendingUserIds = isAdmin
    ? rows
        .filter(
          (r) =>
            r.approvalStatus === null &&
            (r.totalWorkMs > 0 || r.totalBreakMs > 0),
        )
        .map((r) => r.userId)
    : [];

  // Summary numbers reflect the CURRENT filtered slice (dept × status).
  const summary = visibleRows.reduce(
    (acc, r) => {
      acc.workMs += r.totalWorkMs;
      acc.breakMs += r.totalBreakMs;
      if (r.totalWorkMs > 0) acc.onShift += 1;
      if (r.costAud != null) acc.costAud += r.costAud;
      if (r.awardCostAud != null) acc.awardCostAud += r.awardCostAud;
      acc.plannedMs += r.plannedTotalMs;
      return acc;
    },
    {
      workMs: 0,
      breakMs: 0,
      onShift: 0,
      costAud: 0,
      awardCostAud: 0,
      plannedMs: 0,
    },
  );
  // Hide the cost card entirely if no row in the slice has cost data —
  // a tenant that hasn't set any hourly rates shouldn't see "$0.00".
  const anyCost = visibleRows.some((r) => r.costAud != null);
  const anyPlanned = visibleRows.some((r) => r.plannedTotalMs > 0);

    return {
      weekStart,
      weekEnd,
      weekStartIso,
      weekLabel: formatWeekLabel(weekStart, weekEnd),
      memberRows,
      rows,
      visibleRows,
      statusCounts,
      summary,
      anyCost,
      anyPlanned,
      pendingUserIds,
      activityByUser,
      xeroExportByUser,
      xeroFailed,
      xeroLastError,
      deptByUserId,
      locationRows,
      departments,
    };
  }

  const weeks = await Promise.all(weekStarts.map((w) => buildWeekData(w)));

  // ─── Cross-week aggregates for the shared toolbar / summary / pills ───
  // The toolbar, summary cards and status pills sit above both week blocks, so
  // their numbers sum across the visible window. Per-week data (visibleRows,
  // approvals, Xero state) stays on each `weeks[i]` and is consumed per block.
  const w0 = weeks[0]!;
  const combinedSummary = weeks.reduce(
    (acc, w) => {
      acc.workMs += w.summary.workMs;
      acc.breakMs += w.summary.breakMs;
      acc.onShift += w.summary.onShift;
      acc.costAud += w.summary.costAud;
      acc.awardCostAud += w.summary.awardCostAud;
      acc.plannedMs += w.summary.plannedMs;
      return acc;
    },
    {
      workMs: 0,
      breakMs: 0,
      onShift: 0,
      costAud: 0,
      awardCostAud: 0,
      plannedMs: 0,
    },
  );
  const anyCost = weeks.some((w) => w.anyCost);
  const anyPlanned = weeks.some((w) => w.anyPlanned);
  const varianceMs = combinedSummary.workMs - combinedSummary.plannedMs;
  // "On shift" is a headcount, so count distinct people across the window
  // rather than summing each week's count (which double-counts anyone who
  // worked both weeks). Matches the per-week number in 1 WK mode.
  const onShiftUserIds = new Set<string>();
  for (const w of weeks) {
    for (const r of w.visibleRows) {
      if (r.totalWorkMs > 0) onShiftUserIds.add(r.userId);
    }
  }
  const onShiftCount = onShiftUserIds.size;
  const statusCounts: Record<StatusFilter, number> = {
    all: weeks.reduce((s, w) => s + w.statusCounts.all, 0),
    pending: weeks.reduce((s, w) => s + w.statusCounts.pending, 0),
    approved: weeks.reduce((s, w) => s + w.statusCounts.approved, 0),
    disputed: weeks.reduce((s, w) => s + w.statusCounts.disputed, 0),
    no_activity: weeks.reduce((s, w) => s + w.statusCounts.no_activity, 0),
  };
  const departments = w0.departments;

  // CSV export covers the whole visible window (week 1, or both weeks in 2 WK)
  // and preserves the dept + status filter so what you see is what you get.
  const exportParams = new URLSearchParams({ week: fmtIsoDate(weekStart) });
  if (deptFilter) exportParams.set("dept", deptFilter);
  if (statusFilter !== "all") exportParams.set("status", statusFilter);
  if (range !== "1w") exportParams.set("range", range);
  const exportHref = `/api/timesheets/export?${exportParams.toString()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      {/* ─── Sticky toolbar (mirrors the schedule screen) ───
          Pinned below the TopBar so the date nav, the 1/2 WK toggle and the
          Day key stay visible while the grid(s) scroll underneath. */}
      <div className="sticky top-0 z-20 -mx-6 flex flex-col gap-3 border-b border-line bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] px-6 py-3 backdrop-blur md:top-16">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <h2 className="font-display text-base font-semibold tracking-[-0.01em] text-ink">
              {`${weekStart.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "long",
              })} – ${addDays(windowEnd, -1).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "long",
              })}`}
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                · {onShiftCount} on shift
              </span>
            </h2>
            <DayKeyLegend />
          </div>
          {/* Date nav · range toggle · actions, split by a hairline. */}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/app/timesheets${qsFor({ week: fmtIsoDate(prevWeek) })}`}
              >
                ← Prev
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/app/timesheets${qsFor({ week: fmtIsoDate(startOfWeek(now)) })}`}
              >
                Today
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/app/timesheets${qsFor({ week: fmtIsoDate(nextWeek) })}`}
              >
                Next →
              </Link>
            </Button>
            {/* 1 WK / 2 WK segmented toggle. 2 WK stacks two week blocks. */}
            <div className="inline-flex gap-0.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-0.5">
              {(["1w", "2w"] as const).map((r) => (
                <Link
                  key={r}
                  href={`/app/timesheets${qsFor({ range: r })}`}
                  className={`whitespace-nowrap rounded-[calc(var(--r-sm)-3px)] px-3 py-1.5 text-xs font-semibold uppercase transition-colors ${
                    range === r
                      ? "bg-[var(--raise)] text-ink shadow-[var(--shadow-sm)] dark:bg-[var(--accent)] dark:text-[var(--accent-ink)]"
                      : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {r === "1w" ? "1 wk" : "2 wk"}
                </Link>
              ))}
            </div>
            <span className="mx-1 h-6 w-px self-center bg-line" aria-hidden />
            <Button asChild variant="outline" size="sm">
              <a href={exportHref}>Export CSV</a>
            </Button>
            {isAdmin && <CloseStaleClockInsButton />}
            {isAdmin && (
              <AddEntryForm
                employees={w0.memberRows}
                locations={w0.locationRows}
                defaultDate={fmtIsoDate(weekStart)}
              />
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {canViewTeam
          ? "Hours per employee for the selected period, auto-built from clock punches."
          : "Your hours for the selected period, auto-built from your clock punches."}
      </p>

      {isAdmin ? (
        <>
          {/* ─── Summary bar ─── */}
          <section
            className={`grid gap-3 ${
              anyCost && anyPlanned
                ? "sm:grid-cols-4"
                : anyCost || anyPlanned
                  ? "sm:grid-cols-4"
                  : "sm:grid-cols-3"
            }`}
          >
            <StatCard label="Total work" value={fmtHours(combinedSummary.workMs)} />
            <StatCard label="Total break" value={fmtHours(combinedSummary.breakMs)} />
            <StatCard
              label="On shift"
              value={`${onShiftCount} ${onShiftCount === 1 ? "person" : "people"}`}
            />
            {anyPlanned ? (
              <StatCard
                label="Planned vs actual"
                value={fmtHours(combinedSummary.plannedMs)}
                hint={
                  varianceMs === 0
                    ? "On plan"
                    : `${varianceMs > 0 ? "+" : "−"}${fmtHours(Math.abs(varianceMs))} ${varianceMs > 0 ? "over" : "under"}`
                }
                hintTone={
                  varianceMs > 0
                    ? "amber"
                    : varianceMs < 0
                      ? "amber"
                      : "neutral"
                }
              />
            ) : null}
            {anyCost ? (
              <StatCard
                label="Total cost (AUD)"
                value={fmtAud(combinedSummary.costAud)}
                hint={
                  combinedSummary.awardCostAud !== combinedSummary.costAud
                    ? `Award-derived: ${fmtAud(roundCents(combinedSummary.awardCostAud))}`
                    : "Award-derived matches"
                }
                hintTone={
                  combinedSummary.awardCostAud > combinedSummary.costAud
                    ? "amber"
                    : "neutral"
                }
              />
            ) : null}
          </section>

          {/* ─── Status filter pills ─── */}
          <section className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((s) => {
              const active = statusFilter === s;
              const count = statusCounts[s];
              const label = STATUS_PILL_LABEL[s];
              return (
                <Link
                  key={s}
                  href={`/app/timesheets${qsFor({ status: s })}`}
                  className={
                    active
                      ? "inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                      : "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                  }
                >
                  {label}
                  <span
                    className={
                      active
                        ? "rounded-full bg-primary-foreground/20 px-1.5 text-[10px] tabular-nums"
                        : "rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground"
                    }
                  >
                    {count}
                  </span>
                </Link>
              );
            })}
          </section>

          {/* ─── Dept filter form ─── */}
          <form
            action="/app/timesheets"
            method="get"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            {/* Preserve the active week + status so picking a department
                doesn't snap back to defaults. */}
            {week ? (
              <input type="hidden" name="week" value={week} />
            ) : null}
            {statusFilter !== "all" ? (
              <input type="hidden" name="status" value={statusFilter} />
            ) : null}
            {range !== "1w" ? (
              <input type="hidden" name="range" value={range} />
            ) : null}
            <label
              htmlFor="dept-filter"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
            >
              Department:
            </label>
            <select
              id="dept-filter"
              name="dept"
              defaultValue={deptFilter}
              className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            >
              <option value="">All departments</option>
              <option value="none">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              Apply
            </Button>
            {deptFilter ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/app/timesheets${qsFor({ dept: null })}`}>
                  Clear
                </Link>
              </Button>
            ) : null}
          </form>

          {/* R1 Feature 2 — Xero retry moved into each week block (per-week
              pay-run state). R1 Features 3+4 — email managers a digest. */}
          <ApprovalDigestButton />
        </>
      ) : null}

      {digestCount != null && Number.isFinite(digestCount) ? (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {digestCount > 0
            ? `Emailed managers — ${digestCount} timesheet${digestCount === 1 ? "" : "s"} awaiting approval flagged.`
            : "Emailed — no pending timesheets, everyone's caught up."}
        </div>
      ) : null}

      {/* One block per visible week (1 in 1 WK, 2 stacked in 2 WK). Each block
          owns its own table, approvals and Xero state; the column layout uses
          the combined `anyCost` so the two grids stay aligned. */}
      {weeks.map((wk, wkIndex) => {
        const {
          weekStart,
          weekEnd,
          weekStartIso,
          weekLabel,
          visibleRows,
          pendingUserIds,
          activityByUser,
          xeroExportByUser,
          xeroFailed,
          xeroLastError,
          deptByUserId,
        } = wk;
        const showCheckbox = isAdmin;
        // Checkbox (admin) + chevron + Employee + 7 weekdays + Work + Break
        // + (optional Cost) + Status. The expansion <tr> uses this to
        // colspan the full width.
        const totalColumnCount =
          (showCheckbox ? 1 : 0) +
          1 +
          1 +
          7 +
          1 +
          1 +
          (anyCost ? 1 : 0) +
          1;

        const tableSection = (
          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            {visibleRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No clock activity recorded for this week.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      {showCheckbox ? (
                        <th className="w-8 px-2 py-2" aria-hidden />
                      ) : null}
                      <th className="w-8 px-2 py-2" aria-hidden />
                      <th className="px-4 py-2 font-medium">Employee</th>
                      {WEEKDAYS.map((d, i) => (
                        <th key={d} className="px-3 py-2 font-medium">
                          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                            {d}
                          </div>
                          <div className="font-mono text-[10px] text-ink-3">
                            {fmtDayHeader(addDays(weekStart, i))}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Work
                          <InfoPopover label="About the Work column">
                            <p className="font-semibold">Hours classification</p>
                            <p className="mt-1">
                              The total in the cell is raw worked time.
                              The smaller line below splits it into
                              <strong> ordinary</strong>, <strong>OT 1.5×</strong>,
                              and <strong>OT 2×</strong> per your award
                              profile (8h daily / 38h weekly defaults).
                            </p>
                            <p className="mt-1">
                              Public-holiday weeks show a chip in the
                              name column — penalty rates apply to those
                              days in the cost calc.
                            </p>
                          </InfoPopover>
                        </span>
                      </th>
                      <th className="px-3 py-2 font-medium">Break</th>
                      {anyCost ? (
                        <th className="px-3 py-2 font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            Cost
                            <InfoPopover label="About the Cost column">
                              <p className="font-semibold">Two cost lines</p>
                              <p className="mt-1">
                                <strong>Top:</strong> flat cost (rate ×
                                hours) — the legacy figure.
                              </p>
                              <p className="mt-1">
                                <strong>Bottom (amber):</strong>{" "}
                                award-derived cost using OT × penalty
                                multipliers under the policy set in
                                workspace settings (or per-employee
                                override).
                              </p>
                              <p className="mt-1">
                                When the two match (clean weekday week,
                                no OT), the second line is hidden to
                                reduce noise.
                              </p>
                            </InfoPopover>
                          </span>
                        </th>
                      ) : null}
                      <th className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          Status
                          <InfoPopover
                            label="About the Status column"
                            align="right"
                          >
                            <p className="font-semibold">Approval &amp; lock</p>
                            <p className="mt-1">
                              <strong>Pending</strong> — has activity,
                              awaiting your call.
                            </p>
                            <p className="mt-1">
                              <strong>Approved · Locked</strong> —
                              clock-event edits frozen. The “+ Add
                              punch” and ✎ edit buttons disappear from
                              every row in that week.
                            </p>
                            <p className="mt-1">
                              <strong>Disputed</strong> — flagged for
                              re-check; notes show under the badge.
                            </p>
                            <p className="mt-1">
                              The red <strong>Reopen</strong> button on
                              an approved row prompts for a reason; the
                              reason lands in the audit log next to a
                              <em> shiftcraft.timesheet.reopened</em>{" "}
                              event.
                            </p>
                          </InfoPopover>
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleRows.map((r) => {
                      const link = deptByUserId.get(r.userId);
                      const deptLabel = link?.departmentName ?? null;
                      const perDayActualDisplay = r.perDay.map((ms) =>
                        ms > 0 ? fmtHours(ms) : "—",
                      );
                      // Enrich each PerDayDetailEntry with the pre-formatted
                      // planned / actual / Δ display strings the client row
                      // component renders verbatim.
                      const detailForRow = r.perDayDetail.map((d) => {
                        const delta = d.actualWorkMs - d.plannedMs;
                        const hasPlan = d.plannedMs > 0;
                        const deltaTone: "amber" | "emerald" | "neutral" | null =
                          !hasPlan
                            ? null
                            : delta === 0
                              ? "neutral"
                              : "amber";
                        return {
                          dayLabel: d.dayLabel,
                          dayIso: d.dayIso,
                          plannedLabel: hasPlan
                            ? `Planned ${fmtHours(d.plannedMs)}`
                            : null,
                          actualLabel: `Actual ${fmtHours(d.actualWorkMs)}`,
                          deltaLabel: hasPlan
                            ? delta === 0
                              ? "On plan"
                              : `Δ ${delta > 0 ? "+" : "−"}${fmtHours(Math.abs(delta))}`
                            : null,
                          deltaTone,
                          segments: d.segments,
                        };
                      });
                      // #4 — the whole-week approve control only appears once at
                      // least one day's shift is complete (worked + clocked out
                      // + not in the future). An in-progress or all-future week
                      // shows the Pending badge but no Approve button.
                      const hasApprovableActivity = r.perDayMeta.some(
                        (d) => d.isComplete,
                      );
                      const approvalCell = (
                        <ApprovalCell
                          userId={r.userId}
                          weekStartIso={weekStartIso}
                          status={r.approvalStatus}
                          notes={r.approvalNotes}
                          canManage={canApprove}
                          hasActivity={
                            r.totalWorkMs > 0 || r.totalBreakMs > 0
                          }
                          hasApprovableActivity={hasApprovableActivity}
                        />
                      );
                      return (
                        <TimesheetRow
                          key={r.userId}
                          userId={r.userId}
                          name={r.name}
                          email={r.email}
                          deptLabel={deptLabel}
                          perDayActualDisplay={perDayActualDisplay}
                          perDayActualMs={r.perDay}
                          perDayMeta={r.perDayMeta}
                          completedDaysCsv={r.perDayMeta
                            .filter((d) => d.isComplete)
                            .map((d) => d.dayIso)
                            .join(",")}
                          totalWorkDisplay={fmtHours(r.totalWorkMs)}
                          totalBreakDisplay={fmtHours(r.totalBreakMs)}
                          costDisplay={fmtAud(r.costAud)}
                          perDayDetail={detailForRow}
                          totalColumnCount={totalColumnCount}
                          approvalCell={approvalCell}
                          isAdmin={isAdmin}
                          canManage={canApprove}
                          showCost={anyCost}
                          showCheckbox={showCheckbox}
                          anomalies={r.anomalies}
                          anomalyFixes={r.anomalyFixes}
                          weekStartIso={weekStartIso}
                          weekLabel={weekLabel}
                          approvalStatus={r.approvalStatus}
                          approvalNotes={r.approvalNotes}
                          approverName={r.approverName}
                          approvedAtIso={r.approvedAtIso}
                          totalWorkMs={r.totalWorkMs}
                          totalBreakMs={r.totalBreakMs}
                          hourlyRate={r.hourlyRate}
                          costAud={r.costAud}
                          activity={activityByUser.get(r.userId) ?? []}
                          awardBreakdownDisplay={r.awardBreakdownDisplay}
                          publicHolidayCount={r.publicHolidayCount}
                          awardCostDisplay={fmtAud(r.awardCostAud)}
                          awardCostMatchesFlat={
                            r.awardCostAud === r.costAud ||
                            r.awardCostAud == null
                          }
                          xeroExport={xeroExportByUser.get(r.userId) ?? null}
                        />
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </section>
        );

        const block =
          isAdmin && visibleRows.length > 0 ? (
            <BulkSelectionForm
              weekStartIso={weekStartIso}
              pendingUserIds={pendingUserIds}
            >
              {tableSection}
            </BulkSelectionForm>
          ) : (
            tableSection
          );

        return (
          <div key={weekStartIso} className="space-y-3">
            {/* Week subheader — only when stacking two weeks. */}
            {weekCount > 1 ? (
              <div className="flex items-center gap-3 pt-1">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                  Week {wkIndex + 1}
                </span>
                <span className="text-sm font-medium text-ink-2">
                  {`${weekStart.toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })} – ${addDays(weekEnd, -1).toLocaleDateString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}`}
                </span>
                <span className="h-px flex-1 bg-line-soft" aria-hidden />
              </div>
            ) : null}
            {/* R1 Feature 2 — retry the Xero push right where the failure shows. */}
            {isAdmin && xeroFailed ? (
              <XeroRetryButton
                weekStartIso={weekStartIso}
                lastError={xeroLastError}
              />
            ) : null}
            {block}
          </div>
        );
      })}

      <p className="text-[11px] text-muted-foreground">
        Hours are derived from the append-only clock-event stream. Overnight
        shifts are split at midnight so each day's total is contained within
        that calendar date. A still-clocked-in shift shows live time so far
        (blue, ⏱) and can't be approved until it's clocked out; days that
        haven't happened yet are greyed. Managers can approve, dispute, or
        reset each employee's week — the status column reflects the latest
        state and is included in the CSV export.
      </p>
    </div>
  );
}

function ApprovalCell({
  userId,
  weekStartIso,
  status,
  notes,
  canManage,
  hasActivity,
  hasApprovableActivity,
}: {
  userId: string;
  weekStartIso: string;
  status: ScTimesheetApprovalStatus | null;
  notes: string | null;
  canManage: boolean;
  hasActivity: boolean;
  /** #4 — at least one day's shift is complete, so approving is meaningful. */
  hasApprovableActivity: boolean;
}) {
  const badge =
    status === "approved" ? (
      // Audit #4 — approved week is read-only. The "Locked" wording +
      // the gated edit affordances in TimesheetRow communicate the
      // state at both glance and interaction levels.
      <Badge
        variant="live"
        size="sm"
        title="Approved — clock-event edits are locked. Use Reopen to unlock."
      >
        Approved · Locked
      </Badge>
    ) : status === "disputed" ? (
      <Badge variant="warn" size="sm">Disputed</Badge>
    ) : hasActivity ? (
      <Badge variant="neutral" size="sm">Pending</Badge>
    ) : (
      <span className="text-[10px] text-ink-3">—</span>
    );

  if (!canManage) {
    return (
      <div className="space-y-1">
        {badge}
        {status === "disputed" && notes && (
          <p className="max-w-[14rem] text-[10px] text-muted-foreground">
            {notes}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {badge}
      {status === "disputed" && notes && (
        <p className="max-w-[14rem] text-[10px] text-muted-foreground">
          {notes}
        </p>
      )}
      <ApprovalButtons
        userId={userId}
        weekStartIso={weekStartIso}
        status={status}
        hasActivity={hasApprovableActivity}
      />
    </div>
  );
}

const STATUS_PILL_LABEL: Record<StatusFilter, string> = {
  all: "All",
  pending: "Pending",
  approved: "Approved",
  disputed: "Disputed",
  no_activity: "No activity",
};

// Colour key for the per-day cells. Mirrors the tile styling in _row.tsx so a
// manager can decode the grid at a glance (#5). Status (approved / disputed /
// pending) is labelled in the Status column's badges, so this covers day state.
// Rendered inside the sticky toolbar (no table chrome) so it stays in view.
function DayKeyLegend() {
  const swatch = "inline-block h-3 w-3 rounded-[3px] border";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
      <span className="font-mono font-medium uppercase tracking-wider text-ink-3">
        Day key
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            borderColor: "var(--line-soft)",
            background: "rgba(217,131,36,0.45)",
          }}
          aria-hidden
        />
        Worked (deeper = more hours)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            borderColor: "#2563eb",
            background: "color-mix(in srgb, #2563eb 18%, transparent)",
          }}
          aria-hidden
        />
        ⏱ In progress
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            borderColor: "var(--live)",
            background: "color-mix(in srgb, var(--live) 18%, transparent)",
          }}
          aria-hidden
        />
        ✓ Approved
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            borderColor: "var(--warn)",
            background: "color-mix(in srgb, var(--warn) 18%, transparent)",
          }}
          aria-hidden
        />
        ! Disputed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={swatch}
          style={{
            borderColor: "var(--danger)",
            background: "color-mix(in srgb, var(--danger) 18%, transparent)",
          }}
          aria-hidden
        />
        No-show (rostered, absent)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`${swatch} border-dashed opacity-60`}
          style={{
            borderColor: "var(--line-soft)",
            background: "var(--paper-2)",
          }}
          aria-hidden
        />
        Upcoming
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  hintTone,
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: "amber" | "emerald" | "neutral";
}) {
  const hintClass =
    hintTone === "amber"
      ? "text-[var(--warn)]"
      : hintTone === "emerald"
        ? "text-[var(--live)]"
        : "text-muted-foreground";
  return (
    <div className="rounded-[var(--r-md)] border border-line bg-[var(--paper)] p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint ? (
        <div className={`mt-0.5 text-[11px] font-medium ${hintClass}`}>{hint}</div>
      ) : null}
    </div>
  );
}

// Display-only DD-MM-YY for the weekday column headers. Uses the same local
// date getters as fmtIsoDate so it never drifts by a day; do NOT swap this for
// fmtIsoDate, which is the canonical ISO key used for URLs and lookups.
function fmtDayHeader(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${String(
    d.getMonth() + 1,
  ).padStart(2, "0")}-${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

function formatWeekLabel(start: Date, end: Date): string {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth();
  const opts: Intl.DateTimeFormatOptions = sameMonth
    ? { day: "numeric" }
    : { day: "numeric", month: "short" };
  return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${last.toLocaleDateString(undefined, sameMonth ? opts : { day: "numeric", month: "short" })}`;
}
