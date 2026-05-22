import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
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
  users,
  type ScTimesheetApprovalStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { isAtLeastManager } from "~/lib/roles";
import {
  addDays,
  fmtHours,
  fmtIsoDate,
  getEventsInRangeForTenant,
  getEventsInRangeForUser,
  parseIsoDate,
  startOfWeek,
} from "~/lib/clock";
import {
  approveTimesheetAction,
  clearTimesheetApprovalAction,
  disputeTimesheetAction,
} from "./actions";
import { TimesheetRow } from "./_row";
import { BulkSelectionForm } from "./_bulk_form";

export const metadata = { title: "Timesheets · ShiftCraft" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type AnomalyKind =
  | "overtime_week"
  | "long_shift"
  | "no_clockout"
  | "no_show";

interface RowTotals {
  userId: string;
  name: string;
  email: string;
  /** workMs per day index 0..6 (Mon..Sun). */
  perDay: number[];
  totalWorkMs: number;
  totalBreakMs: number;
  approvalStatus: ScTimesheetApprovalStatus | null;
  approvalNotes: string | null;
  /** Numeric cost in AUD (work hours × hourly_rate). null if rate not set. */
  costAud: number | null;
  /** Pre-formatted per-day segment breakdown for the expansion row. Empty
   *  array on days with no events; outer length up to 7. */
  perDayDetail: PerDayDetailEntry[];
  /** Planned ms per day index 0..6 (Mon..Sun) from accepted shifts. */
  plannedDailyMs: number[];
  plannedTotalMs: number;
  anomalies: AnomalyKind[];
}

interface PerDayDetailEntry {
  /** Human label like "Mon 19 May". */
  dayLabel: string;
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
  }>;
}

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
  searchParams: Promise<{ week?: string; dept?: string; status?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const membership = await currentMembership();
  if (!membership) redirect("/app");

  const isAdmin =
    membership.role === "owner" || membership.role === "admin";
  const tenantId = membership.tenant.id;

  const { week, dept, status: statusRaw } = await searchParams;
  const deptFilter = dept ?? "";
  const statusFilter = parseStatusFilter(statusRaw);
  const weekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  const weekEnd = addDays(weekStart, 7);
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  // Build query-string preserving the active filters so week navigation
  // and the Clear button don't drop a selection. Pass `null` for an
  // override to deliberately clear that param.
  const qsFor = (overrides: {
    week?: string;
    dept?: string | null;
    status?: StatusFilter | null;
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
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  // Resolve which users to show. Admins: everyone in the tenant. Non-admins:
  // just themselves.
  const allMemberRows = isAdmin
    ? await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.tenantId, tenantId))
    : [
        {
          userId: user.id,
          name: user.name,
          email: user.email,
        },
      ];

  // Pull the auth-user → department mapping from the per-tenant sc_employees
  // table. Used both for the filter and for rendering the department name
  // alongside each row when a filter is active. Only admins ever need it.
  // Departments list is loaded for the dropdown options.
  const [scLinks, departments] = isAdmin
    ? await forTenant(tenantId).run((tx) =>
        Promise.all([
          tx
            .select({
              appUserId: scEmployees.appUserId,
              departmentId: scEmployees.departmentId,
              departmentName: scDepartments.name,
              hourlyRate: scEmployees.hourlyRate,
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
    }
  >();
  for (const link of scLinks) {
    if (link.appUserId) {
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
      });
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
  const allEvents = isAdmin
    ? await getEventsInRangeForTenant(tenantId, weekStart, weekEnd)
    : await getEventsInRangeForUser(tenantId, user.id, weekStart, weekEnd);

  const weekStartIso = fmtIsoDate(weekStart);
  const approvalRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeUserId: scTimesheetApprovals.employeeUserId,
        status: scTimesheetApprovals.status,
        notes: scTimesheetApprovals.notes,
      })
      .from(scTimesheetApprovals)
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
      },
    ]),
  );

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
    }
    const segs: SegMeta[] = [];
    let open: {
      kind: "work" | "break";
      startedAt: Date;
      eventId: string;
      source: string;
      locationId: string | null;
    } | null = null;
    const closeOpen = (endedAt: Date) => {
      if (!open) return;
      if (endedAt > open.startedAt) {
        segs.push({
          kind: open.kind,
          startedAt: open.startedAt,
          endedAt,
          openingEventId: open.eventId,
          openingSource: open.source,
          openingLocationId: open.locationId,
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
            };
          }
          break;
        case "break_start":
          if (open?.kind === "work") {
            closeOpen(e.occurredAt);
            open = {
              kind: "break",
              startedAt: e.occurredAt,
              eventId: e.id,
              source: e.source,
              locationId: e.locationId,
            };
          }
          break;
        case "break_end":
          if (open?.kind === "break") {
            closeOpen(e.occurredAt);
            open = {
              kind: "work",
              startedAt: e.occurredAt,
              eventId: e.id,
              source: e.source,
              locationId: e.locationId,
            };
          }
          break;
        case "out":
          closeOpen(e.occurredAt);
          break;
        default:
          break;
      }
    }
    // Track whether the user was left open at week-end (anomaly signal)
    // BEFORE force-closing for the aggregation.
    const hadOpenAtWeekEnd = open !== null;
    if (open) closeOpen(weekEnd);

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
        })),
      });
    }

    const plannedTotalMs = planned.reduce((sum, ms) => sum + ms, 0);

    // Anomaly derivation — pure functions of the totals above.
    const anomalies: AnomalyKind[] = [];
    if (totalWork > 40 * 3_600_000) anomalies.push("overtime_week");
    if (perDay.some((ms) => ms > 10 * 3_600_000)) anomalies.push("long_shift");
    if (hadOpenAtWeekEnd) anomalies.push("no_clockout");
    if (plannedTotalMs > 0 && totalWork === 0) anomalies.push("no_show");

    const approval = approvalByUser.get(m.userId);
    const rate = deptByUserId.get(m.userId)?.hourlyRate ?? null;
    const costAud =
      rate != null && totalWork > 0
        ? Math.round((rate * (totalWork / 3_600_000)) * 100) / 100
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
      costAud,
      perDayDetail,
      plannedDailyMs: planned,
      plannedTotalMs,
      anomalies,
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
        return hasActivity || isAdmin;
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

  // Summary numbers reflect the CURRENT filtered slice (dept × status).
  const summary = visibleRows.reduce(
    (acc, r) => {
      acc.workMs += r.totalWorkMs;
      acc.breakMs += r.totalBreakMs;
      if (r.totalWorkMs > 0) acc.onShift += 1;
      if (r.costAud != null) acc.costAud += r.costAud;
      acc.plannedMs += r.plannedTotalMs;
      return acc;
    },
    { workMs: 0, breakMs: 0, onShift: 0, costAud: 0, plannedMs: 0 },
  );
  // Hide the cost card entirely if no row in the slice has cost data —
  // a tenant that hasn't set any hourly rates shouldn't see "$0.00".
  const anyCost = visibleRows.some((r) => r.costAud != null);
  const anyPlanned = visibleRows.some((r) => r.plannedTotalMs > 0);
  const varianceMs = summary.workMs - summary.plannedMs;

  const weekLabel = formatWeekLabel(weekStart, weekEnd);
  // CSV export preserves the dept + status filter so what you see is what
  // you get. (Export route handler reads `dept` already; `status` is
  // forwarded for future use.)
  const exportParams = new URLSearchParams({ week: fmtIsoDate(weekStart) });
  if (deptFilter) exportParams.set("dept", deptFilter);
  if (statusFilter !== "all") exportParams.set("status", statusFilter);
  const exportHref = `/api/timesheets/export?${exportParams.toString()}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timesheets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Hours per employee for the selected week, auto-built from clock punches."
              : "Your hours for the selected week, auto-built from your clock punches."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/timesheets${qsFor({ week: fmtIsoDate(prevWeek) })}`}>
              ← Previous
            </Link>
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
            {weekLabel}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/timesheets${qsFor({ week: fmtIsoDate(nextWeek) })}`}>
              Next →
            </Link>
          </Button>
          <Button asChild size="sm">
            <a href={exportHref}>Export CSV</a>
          </Button>
        </div>
      </div>

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
            <StatCard label="Total work" value={fmtHours(summary.workMs)} />
            <StatCard label="Total break" value={fmtHours(summary.breakMs)} />
            <StatCard
              label="On shift"
              value={`${summary.onShift} ${summary.onShift === 1 ? "person" : "people"}`}
            />
            {anyPlanned ? (
              <StatCard
                label="Planned vs actual"
                value={fmtHours(summary.plannedMs)}
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
                value={fmtAud(summary.costAud)}
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
            <label
              htmlFor="dept-filter"
              className="text-xs uppercase tracking-wider text-muted-foreground"
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
        </>
      ) : null}

      {(() => {
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
                          <div>{d}</div>
                          <div className="font-mono text-[10px] text-muted-foreground/70">
                            {fmtIsoDate(addDays(weekStart, i))}
                          </div>
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium">Work</th>
                      <th className="px-3 py-2 font-medium">Break</th>
                      {anyCost ? (
                        <th className="px-3 py-2 font-medium">Cost</th>
                      ) : null}
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleRows.map((r) => {
                      const link = deptByUserId.get(r.userId);
                      const deptLabel = link?.departmentName ?? null;
                      const perDayActualDisplay = r.perDay.map((ms) =>
                        ms > 0 ? fmtHours(ms) : "—",
                      );
                      const perDayPlannedDisplay = r.plannedDailyMs.map((ms) =>
                        ms > 0 ? fmtHours(ms) : "",
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
                      const approvalCell = (
                        <ApprovalCell
                          userId={r.userId}
                          weekStartIso={weekStartIso}
                          status={r.approvalStatus}
                          notes={r.approvalNotes}
                          canManage={isAtLeastManager(membership.role)}
                          hasActivity={
                            r.totalWorkMs > 0 || r.totalBreakMs > 0
                          }
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
                          perDayPlannedDisplay={perDayPlannedDisplay}
                          totalWorkDisplay={fmtHours(r.totalWorkMs)}
                          totalBreakDisplay={fmtHours(r.totalBreakMs)}
                          costDisplay={fmtAud(r.costAud)}
                          perDayDetail={detailForRow}
                          totalColumnCount={totalColumnCount}
                          approvalCell={approvalCell}
                          isAdmin={isAdmin}
                          showCost={anyCost}
                          showCheckbox={showCheckbox}
                          anomalies={r.anomalies}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );

        return isAdmin && visibleRows.length > 0 ? (
          <BulkSelectionForm weekStartIso={weekStartIso}>
            {tableSection}
          </BulkSelectionForm>
        ) : (
          tableSection
        );
      })()}

      <p className="text-[11px] text-muted-foreground">
        Hours are derived from the append-only clock-event stream. Overnight
        shifts are split at midnight so each day's total is contained within
        that calendar date. Managers can approve, dispute, or reset each
        employee's week — the status column reflects the latest state and
        is included in the CSV export.
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
}: {
  userId: string;
  weekStartIso: string;
  status: ScTimesheetApprovalStatus | null;
  notes: string | null;
  canManage: boolean;
  hasActivity: boolean;
}) {
  const chipBase =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider";
  const badge =
    status === "approved" ? (
      <span className={`${chipBase} bg-emerald-600 text-white`}>Approved</span>
    ) : status === "disputed" ? (
      <span className={`${chipBase} bg-amber-500 text-white`}>Disputed</span>
    ) : hasActivity ? (
      <span className={`${chipBase} bg-slate-500 text-white`}>Pending</span>
    ) : (
      <span className="text-[10px] text-muted-foreground/60">—</span>
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
      <div className="flex flex-wrap gap-1">
        {status !== "approved" && hasActivity && (
          <form action={approveTimesheetAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-emerald-700"
            >
              Approve
            </button>
          </form>
        )}
        {status !== "disputed" && hasActivity && (
          <form action={disputeTimesheetAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <input
              type="hidden"
              name="notes"
              value="Flagged by manager — please review punches."
            />
            <button
              type="submit"
              className="rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-amber-600"
            >
              Dispute
            </button>
          </form>
        )}
        {status != null && (
          <form action={clearTimesheetApprovalAction}>
            <input type="hidden" name="employeeUserId" value={userId} />
            <input type="hidden" name="weekStart" value={weekStartIso} />
            <button
              type="submit"
              className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
            >
              Reset
            </button>
          </form>
        )}
      </div>
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
      ? "text-amber-600"
      : hintTone === "emerald"
        ? "text-emerald-600"
        : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
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

function formatWeekLabel(start: Date, end: Date): string {
  const last = addDays(end, -1);
  const sameMonth = start.getMonth() === last.getMonth();
  const opts: Intl.DateTimeFormatOptions = sameMonth
    ? { day: "numeric" }
    : { day: "numeric", month: "short" };
  return `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${last.toLocaleDateString(undefined, sameMonth ? opts : { day: "numeric", month: "short" })}`;
}
