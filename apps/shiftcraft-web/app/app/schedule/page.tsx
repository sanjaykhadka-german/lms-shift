import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, between, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  scTimeOffRequests,
  users,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { forecastWeek } from "~/lib/labour-forecast";
import { getManagedLocationIds, scopeArray } from "~/lib/manager-scope";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { WeeklyLabourForecast } from "~/components/WeeklyLabourForecast";
import {
  AreaScheduleView,
  type AreaShift,
  type AreaShiftSer,
} from "./_area-view";
import { EmployeeScheduleView, type EmployeeRow } from "./_employee-view";
import { PersistRange } from "./_persist-range";
import { PublishMenu } from "./_publish-menu";
import { RepublishBanner } from "./_republish-banner";
import { copyDayToDateAction, repeatWeekAction } from "./actions";
import { InfoPopover } from "~/components/InfoPopover";

type ScheduleView = "day" | "area" | "employee";

export const metadata = { title: "Schedule · ShiftCraft" };

// Returns the Monday 00:00 (local) of the week containing `d`.
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  return monday;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fmtDayHeader(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

const STATUS_VARIANT: Record<string, "neutral" | "live" | "danger"> = {
  draft: "neutral",
  published: "live",
  cancelled: "danger",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    location?: string;
    view?: string;
    range?: string;
    from?: string;
    to?: string;
    employee?: string;
    copied?: string;
    skipped?: string;
    assigned?: string;
    flagged?: string;
  }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const me = await requireUser();
  // AUDIT.md #13 — scope manager visibility to assigned locations.
  // Owners + unscoped admins get the full set; scoped admins only
  // see shifts at their assigned locations. We narrow the location
  // dropdown to the scope too, so the chooser can't be used to peek
  // outside (server-side filter is what enforces; UI just matches).
  const scope = await getManagedLocationIds(
    membership.tenant.id,
    me.id,
    membership.role,
  );
  const scopeIds = scopeArray(scope);

  const {
    week,
    location: locationFilter,
    view: viewRaw,
    range: rangeRaw,
    from: fromRaw,
    to: toRaw,
    employee: employeeRaw,
    copied,
    skipped,
    assigned,
    flagged,
  } = await searchParams;
  // Optional filter: show only shifts the given employee (appUserId) has
  // accepted. Set by clicking a name in the area-view roster.
  const employeeFilter = employeeRaw || undefined;
  // Area is the default view (bare /app/schedule). day/employee opt in.
  const view: ScheduleView =
    viewRaw === "day" ? "day" : viewRaw === "employee" ? "employee" : "area";
  // 1-week (default) or 2-week range. dayCount drives every grid + nav step.
  // The URL wins; with no range param we fall back to the user's last choice
  // (cookie) so an edit/redirect that drops the param keeps you on 2 WK.
  const cookieRange = (await cookies()).get("sc_schedule_range")?.value;
  const range: "1w" | "2w" =
    rangeRaw === "2w"
      ? "2w"
      : rangeRaw === "1w"
        ? "1w"
        : cookieRange === "2w"
          ? "2w"
          : "1w";
  // Kati's rostering feedback #1.C — an explicit custom span via
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides the 1wk/2wk range. Both dates
  // must be valid and from ≤ to; the span is capped at 35 days so a stray
  // range can't blow up the grid/DB. Any week-nav control (Prev/Today/Next,
  // 1wk/2wk) drops from/to via qs() and reverts to week mode.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fromDate =
    fromRaw && DATE_RE.test(fromRaw) ? new Date(`${fromRaw}T00:00:00`) : null;
  const toDate =
    toRaw && DATE_RE.test(toRaw) ? new Date(`${toRaw}T00:00:00`) : null;
  const custom =
    fromDate &&
    toDate &&
    !isNaN(fromDate.getTime()) &&
    !isNaN(toDate.getTime()) &&
    toDate >= fromDate
      ? { from: fromDate, to: toDate }
      : null;
  const copiedCount = Number.parseInt(copied ?? "", 10);
  const skippedCount = Number.parseInt(skipped ?? "", 10);
  const assignedCount = Number.parseInt(assigned ?? "", 10);
  const flaggedCount = Number.parseInt(flagged ?? "", 10);
  const showCopyFlash = Number.isFinite(copiedCount) && copied !== undefined;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  let weekStart: Date;
  let dayCount: number;
  if (custom) {
    weekStart = new Date(custom.from);
    weekStart.setHours(0, 0, 0, 0);
    const span =
      Math.round(
        (Date.UTC(
          custom.to.getFullYear(),
          custom.to.getMonth(),
          custom.to.getDate(),
        ) -
          Date.UTC(
            custom.from.getFullYear(),
            custom.from.getMonth(),
            custom.from.getDate(),
          )) /
          86_400_000,
      ) + 1;
    dayCount = Math.min(35, Math.max(1, span));
  } else {
    dayCount = range === "2w" ? 14 : 7;
    weekStart = startOfWeek(isNaN(anchor.getTime()) ? new Date() : anchor);
  }
  const weekEnd = addDays(weekStart, dayCount); // exclusive

  const qs = (overrides: {
    week?: string;
    location?: string | null;
    view?: ScheduleView | null;
    range?: "1w" | "2w" | null;
    employee?: string | null;
  }) => {
    const params = new URLSearchParams();
    const w = overrides.week ?? week;
    if (w) params.set("week", w);
    const loc =
      overrides.location === null
        ? undefined
        : (overrides.location ?? locationFilter);
    if (loc) params.set("location", loc);
    const v =
      overrides.view === null ? undefined : (overrides.view ?? view);
    if (v && v !== "area") params.set("view", v);
    const r =
      overrides.range === null ? undefined : (overrides.range ?? range);
    // Always emit range so nav links are authoritative and the 1 WK toggle
    // can override a sticky 2 WK cookie.
    if (r) params.set("range", r);
    const emp =
      overrides.employee === null
        ? undefined
        : (overrides.employee ?? employeeFilter);
    if (emp) params.set("employee", emp);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const prevWeek = fmtIsoDate(addDays(weekStart, -dayCount));
  const nextWeek = fmtIsoDate(addDays(weekStart, dayCount));
  const thisWeek = fmtIsoDate(startOfWeek(new Date()));

  const ctx = forTenant(membership.tenant.id);
  const acceptedCount = sql<number>`(
    SELECT count(*)::int FROM ${scShiftAssignments}
    WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
      AND ${scShiftAssignments.status} = 'accepted'
  )`;
  const offeredCount = sql<number>`(
    SELECT count(*)::int FROM ${scShiftAssignments}
    WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
      AND ${scShiftAssignments.status} = 'offered'
  )`;
  // First accepted assignee's display name (auth user.name fallback to email).
  // Null when nobody has accepted yet — area view renders "Unassigned".
  const assigneeName = sql<string | null>`(
    SELECT coalesce(${users.name}, ${users.email}) FROM ${users}
    INNER JOIN ${scShiftAssignments}
      ON ${scShiftAssignments.userId} = ${users.id}
    WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
      AND ${scShiftAssignments.status} = 'accepted'
    ORDER BY ${scShiftAssignments.createdAt} ASC
    LIMIT 1
  )`;
  const [shifts, locations, employees] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({
          id: scShifts.id,
          locationId: scShifts.locationId,
          role: scShifts.role,
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          status: scShifts.status,
          notes: scShifts.notes,
          publishedAt: scShifts.publishedAt,
          updatedAt: scShifts.updatedAt,
          locationName: scLocations.name,
          locationColor: scLocations.color,
          acceptedCount,
          offeredCount,
          assigneeName,
        })
        .from(scShifts)
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .where(
          and(
            eq(scShifts.traceyTenantId, membership.tenant.id),
            between(scShifts.startsAt, weekStart, weekEnd),
            locationFilter ? eq(scShifts.locationId, locationFilter) : undefined,
            scopeIds ? inArray(scShifts.locationId, scopeIds) : undefined,
            employeeFilter
              ? sql`EXISTS (
                  SELECT 1 FROM ${scShiftAssignments}
                  WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
                    AND ${scShiftAssignments.userId} = ${employeeFilter}
                    AND ${scShiftAssignments.status} = 'accepted'
                )`
              : undefined,
          ),
        )
        .orderBy(asc(scShifts.startsAt)),
    ),
    ctx.run((tx) =>
      tx
        .select({
          id: scLocations.id,
          name: scLocations.name,
          color: scLocations.color,
        })
        .from(scLocations)
        .where(
          and(
            eq(scLocations.traceyTenantId, membership.tenant.id),
            scopeIds ? inArray(scLocations.id, scopeIds) : undefined,
          ),
        )
        .orderBy(asc(scLocations.name)),
    ),
    view === "area" || view === "employee"
      ? ctx.run((tx) =>
          tx
            .select({
              id: scEmployees.id,
              fullName: scEmployees.fullName,
              email: scEmployees.email,
              appUserId: scEmployees.appUserId,
              hourlyRate: scEmployees.hourlyRate,
            })
            .from(scEmployees)
            .where(
              and(
                eq(scEmployees.traceyTenantId, membership.tenant.id),
                eq(scEmployees.isActive, true),
              ),
            )
            .orderBy(asc(scEmployees.fullName)),
        )
      : Promise.resolve(
          [] as Array<{
            id: string;
            fullName: string;
            email: string | null;
            appUserId: string | null;
            hourlyRate: string | null;
          }>,
        ),
  ]);

  // For the employee row view we need (shiftId → acceptedUserIds[]) so a
  // shift assigned to multiple people lands in each of their rows. Fetched
  // only when the employee view is selected to keep the area/day queries
  // unchanged.
  const assignmentsByShift = new Map<string, string[]>();
  if (view === "employee" && shifts.length > 0) {
    const shiftIds = shifts.map((s) => s.id);
    const assignmentRows = await ctx.run((tx) =>
      tx
        .select({
          shiftId: scShiftAssignments.shiftId,
          userId: scShiftAssignments.userId,
        })
        .from(scShiftAssignments)
        .where(
          and(
            eq(scShiftAssignments.status, "accepted"),
            inArray(scShiftAssignments.shiftId, shiftIds),
          ),
        ),
    );
    for (const a of assignmentRows) {
      const arr = assignmentsByShift.get(a.shiftId) ?? [];
      arr.push(a.userId);
      assignmentsByShift.set(a.shiftId, arr);
    }
  }

  // ─── Bottom status strip counts ───
  //
  // All admin-visible. Members only see the day/employee grid; the strip
  // is hidden for them. Each metric is bounded by the week being viewed
  // so navigating to a different week refreshes the counts.
  const weekStartIso = fmtIsoDate(weekStart);
  const weekEndInclusiveIso = fmtIsoDate(addDays(weekStart, dayCount - 1));
  const publishedCount = shifts.filter((s) => s.status === "published").length;
  const cancelledCount = shifts.filter((s) => s.status === "cancelled").length;
  const openShiftCount = shifts.filter(
    (s) => s.status !== "cancelled" && s.acceptedCount === 0,
  ).length;

  // Counts are cheap (three COUNT queries) — always fetch so the strip
  // renders consistently across admin/member roles.
  const [swapsPending, leavePending, leaveApprovedWeek] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({ n: count() })
        .from(scShiftSwapRequests)
        .where(
          and(
            eq(scShiftSwapRequests.traceyTenantId, membership.tenant.id),
            eq(scShiftSwapRequests.status, "pending"),
          ),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({ n: count() })
        .from(scTimeOffRequests)
        .where(
          and(
            eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
            eq(scTimeOffRequests.status, "pending"),
          ),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({ n: count() })
        .from(scTimeOffRequests)
        .where(
          and(
            eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
            eq(scTimeOffRequests.status, "approved"),
            lte(scTimeOffRequests.startDate, weekEndInclusiveIso),
            gte(scTimeOffRequests.endDate, weekStartIso),
          ),
        ),
    ),
  ]);

  const stripCounts = {
    published: publishedCount,
    draft: shifts.filter((s) => s.status === "draft").length,
    cancelled: cancelledCount,
    open: openShiftCount,
    swapsPending: swapsPending[0]?.n ?? 0,
    leavePending: leavePending[0]?.n ?? 0,
    leaveApprovedThisWeek: leaveApprovedWeek[0]?.n ?? 0,
  };

  // Group shifts by day index (0=Mon … dayCount-1).
  const days: Array<{ date: Date; shifts: typeof shifts }> = Array.from(
    { length: dayCount },
    (_, i) => ({ date: addDays(weekStart, i), shifts: [] }),
  );
  for (const s of shifts) {
    const idx = Math.floor((s.startsAt.getTime() - weekStart.getTime()) / 86400000);
    const day = days[idx];
    if (day) day.shifts.push(s);
  }

  const canCreate = locations.length > 0;
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  // A shift "needs publishing" when it's a never-published draft OR a published
  // shift that was edited since it last went live (updatedAt past publishedAt).
  // Mirrors the predicate in bulkPublishWeekAction so the menu counts match
  // exactly what the action will flip.
  const needsPublish = (s: {
    status: string;
    publishedAt: Date | null;
    updatedAt: Date;
  }): boolean =>
    s.status === "draft" ||
    (s.status === "published" &&
      (s.publishedAt == null || s.updatedAt.getTime() > s.publishedAt.getTime()));
  const draftCount = shifts.filter((s) => needsPublish(s)).length;
  // Subset of needsPublish: shifts that already went live and were then moved or
  // amended (item 2). These are the urgent ones — staff have the stale version —
  // so they get a dedicated re-publish banner separate from never-published drafts.
  const editedSincePublishCount = shifts.filter(
    (s) =>
      s.status === "published" &&
      (s.publishedAt == null ||
        s.updatedAt.getTime() > s.publishedAt.getTime()),
  ).length;
  const labourForecast = isAdmin
    ? await forecastWeek(membership.tenant.id, weekStart, weekEnd)
    : null;
  const activeLocation = locationFilter
    ? locations.find((l) => l.id === locationFilter)
    : null;

  // Per-area (location, role) "needs publish" counts for the Publish menu.
  // Built from the already-fetched shifts so it costs no extra query; reflects
  // the active location filter when one is set.
  const needsByArea = new Map<string, number>(); // key: `${locationId}|${role}`
  for (const s of shifts) {
    if (!needsPublish(s) || !s.locationId) continue;
    const areaKey = `${s.locationId}|${s.role}`;
    needsByArea.set(areaKey, (needsByArea.get(areaKey) ?? 0) + 1);
  }
  // Per-area publish targets: a "Location › Role" entry for each area with
  // pending changes, so a manager can publish just one department's roster.
  const locationNameById = new Map(locations.map((l) => [l.id, l.name] as const));
  const publishableAreas = Array.from(needsByArea.entries())
    .map(([key, count]) => {
      const [locId, ...roleParts] = key.split("|");
      const role = roleParts.join("|");
      return {
        locationId: locId!,
        role,
        count,
        locationName: locationNameById.get(locId!) ?? "No location",
        label: `${locationNameById.get(locId!) ?? "No location"} › ${role}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  // Distinct roles present in the current view — drives the optional "area"
  // (role) scope on the Copy week / Copy a day menus. Reflects the active
  // location filter since `shifts` is already narrowed to it.
  const rolesInView = Array.from(new Set(shifts.map((s) => s.role))).sort(
    (a, b) => a.localeCompare(b),
  );

  return (
    // The 2-week view needs the whole screen so all 14 columns fit without
    // cramping; the 1-week view stays comfortably capped.
    <div
      className={`mx-auto space-y-6 px-6 py-10 ${
        range === "2w" || dayCount > 7 ? "max-w-none" : "max-w-6xl"
      }`}
    >
      <PersistRange range={range} />
      {/* Kati's rostering feedback #1.A — the action bar stays visible while
          scrolling a long roster. Sits just under the 64px TopBar on desktop;
          bleeds past the container padding (-mx-6) so rows scroll cleanly
          underneath the blurred background. */}
      <div className="sticky top-0 z-20 -mx-6 flex items-start justify-between gap-3 border-b border-line bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] px-6 py-3 backdrop-blur md:top-16">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Schedule
            <InfoPopover label="About the schedule">
              <p>
                Weekly roster grid. <strong>Drafts</strong> are visible
                only to managers; <strong>publish</strong> a shift to
                make it offerable to staff. Use <strong>Auto-fill</strong>{" "}
                to let the scheduler propose assignments from your
                candidate pool.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {fmtRange(weekStart, addDays(weekStart, dayCount - 1))} ·{" "}
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
            {activeLocation ? ` · ${activeLocation.name}` : ""}
          </p>
          {/* Kati's rostering feedback #6 — legend so the status dots on the
              grid read at a glance (matches STATUS_DOT in _area-view). */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: "var(--ink-3)" }}
              />
              Draft
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: "var(--live)" }}
              />
              Published
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: "var(--danger)" }}
              />
              Cancelled
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="rounded-full bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] px-1.5 font-mono text-[8px] uppercase tracking-[0.06em] text-[var(--warn)]">
                edited
              </span>
              changed since publish
            </span>
          </div>
        </div>
        {/* Kati's rostering feedback #1.B — controls grouped by purpose:
            View · Date & range · Actions, separated by hairlines. */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {/* Group 1 — View */}
          <div className="inline-flex gap-0.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-0.5">
            {(["area", "employee", "day"] as const).map((v) => (
              <Link
                key={v}
                href={`/app/schedule${qs({ view: v })}`}
                className={`whitespace-nowrap rounded-[calc(var(--r-sm)-3px)] px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  view === v
                    ? "bg-[var(--raise)] text-ink shadow-[var(--shadow-sm)] dark:bg-[var(--accent)] dark:text-[var(--accent-ink)]"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {v}
              </Link>
            ))}
          </div>
          <span className="mx-1 h-6 w-px self-center bg-line" aria-hidden />
          {/* Group 2 — Date & range */}
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: prevWeek })}`}>← Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: thisWeek })}`}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: nextWeek })}`}>Next →</Link>
          </Button>
          <div className="inline-flex gap-0.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-0.5">
            {(["1w", "2w"] as const).map((r) => (
              <Link
                key={r}
                href={`/app/schedule${qs({ range: r })}`}
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
          {/* Kati's rostering feedback #1.C — pick an arbitrary span. GET form
              sets ?from&to (dropping range/week), so submitting jumps straight
              to the custom view; any week-nav control reverts to 1wk/2wk. */}
          <details className="relative">
            <summary
              className={`inline-flex h-8 cursor-pointer list-none items-center whitespace-nowrap rounded-[var(--r-sm)] border px-3 text-xs font-medium hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] ${
                custom
                  ? "border-[var(--accent-deep)] text-ink"
                  : "border-[color:var(--input)] text-ink-2"
              }`}
            >
              {custom
                ? `${fmtIsoDate(weekStart)} → ${fmtIsoDate(addDays(weekStart, dayCount - 1))}`
                : "Custom…"}
            </summary>
            <form
              method="get"
              className="absolute right-0 z-10 mt-1 flex flex-wrap items-end gap-2 rounded-[var(--r-sm)] border border-border bg-card p-3 shadow-lg"
            >
              {locationFilter && (
                <input type="hidden" name="location" value={locationFilter} />
              )}
              {view !== "area" && (
                <input type="hidden" name="view" value={view} />
              )}
              <label className="flex flex-col gap-1 text-xs text-ink-2">
                From
                <input
                  type="date"
                  name="from"
                  required
                  defaultValue={fmtIsoDate(weekStart)}
                  className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-2">
                To
                <input
                  type="date"
                  name="to"
                  required
                  defaultValue={fmtIsoDate(addDays(weekStart, dayCount - 1))}
                  className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                />
              </label>
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
            </form>
          </details>
          <span className="mx-1 h-6 w-px self-center bg-line" aria-hidden />
          {/* Group 3 — Actions */}
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/schedule/export?from=${fmtIsoDate(weekStart)}&to=${fmtIsoDate(weekEnd)}${locationFilter ? `&location=${locationFilter}` : ""}`}
            >
              Export CSV
            </a>
          </Button>
          {isAdmin && (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/app/schedule/auto-fill?week=${fmtIsoDate(weekStart)}`}
              >
                Auto-fill
              </Link>
            </Button>
          )}
          {isAdmin && draftCount > 0 && (
            <PublishMenu
              weekStartIso={weekStart.toISOString()}
              weekEndIso={weekEnd.toISOString()}
              draftCount={draftCount}
              areas={publishableAreas}
            />
          )}
          {isAdmin && shifts.length > 0 && (
            <details className="relative">
              <summary className="inline-flex h-8 cursor-pointer list-none items-center whitespace-nowrap rounded-[var(--r-sm)] border border-[color:var(--input)] px-3 text-[13px] font-medium hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]">
                Copy week
              </summary>
              <form
                action={repeatWeekAction}
                className="absolute right-0 z-10 mt-1 flex flex-wrap items-end gap-2 rounded-[var(--r-sm)] border border-border bg-card p-3 shadow-lg"
              >
                <input
                  type="hidden"
                  name="weekStart"
                  value={weekStart.toISOString()}
                />
                {locationFilter && (
                  <input type="hidden" name="location" value={locationFilter} />
                )}
                <label className="flex flex-col gap-1 whitespace-nowrap text-xs text-ink-2">
                  Repeat this week for the next
                  <select
                    name="weeks"
                    defaultValue="4"
                    className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                  >
                    <option value="1">1 week</option>
                    <option value="2">2 weeks</option>
                    <option value="4">4 weeks</option>
                    <option value="8">8 weeks</option>
                  </select>
                </label>
                {rolesInView.length > 1 && (
                  <label className="flex flex-col gap-1 whitespace-nowrap text-xs text-ink-2">
                    Area / role
                    <select
                      name="role"
                      defaultValue=""
                      className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                    >
                      <option value="">All roles</option>
                      {rolesInView.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex w-full items-center gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    name="carryAssignments"
                    defaultChecked
                  />
                  Carry staff assignments
                </label>
                <label className="flex w-full items-center gap-2 text-xs text-ink-2">
                  <input type="checkbox" name="force" />
                  Assign even if unavailable / on leave
                </label>
                <Button type="submit" variant="outline" size="sm">
                  Copy
                </Button>
              </form>
            </details>
          )}
          {isAdmin && shifts.length > 0 && (
            <details className="relative">
              <summary className="inline-flex h-8 cursor-pointer list-none items-center whitespace-nowrap rounded-[var(--r-sm)] border border-[color:var(--input)] px-3 text-[13px] font-medium hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]">
                Copy a day
              </summary>
              <form
                action={copyDayToDateAction}
                className="absolute right-0 z-10 mt-1 flex flex-wrap items-end gap-2 rounded-[var(--r-sm)] border border-border bg-card p-3 shadow-lg"
              >
                {locationFilter && (
                  <input type="hidden" name="location" value={locationFilter} />
                )}
                <label className="flex flex-col gap-1 text-xs text-ink-2">
                  From
                  <select
                    name="sourceDate"
                    required
                    className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                  >
                    {Array.from({ length: dayCount }, (_, i) => {
                      const d = addDays(weekStart, i);
                      const iso = fmtIsoDate(d);
                      return (
                        <option key={iso} value={iso}>
                          {fmtDayHeader(d)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-2">
                  To
                  <input
                    type="date"
                    name="targetDate"
                    required
                    // Kati's rostering feedback #4 — can't copy into the past;
                    // the server enforces this too.
                    min={fmtIsoDate(new Date())}
                    defaultValue={fmtIsoDate(addDays(weekStart, dayCount))}
                    className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                  />
                </label>
                {rolesInView.length > 1 && (
                  <label className="flex flex-col gap-1 text-xs text-ink-2">
                    Area / role
                    <select
                      name="role"
                      defaultValue=""
                      className="h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                    >
                      <option value="">All roles</option>
                      {rolesInView.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Button type="submit" variant="outline" size="sm">
                  Copy day
                </Button>
              </form>
            </details>
          )}
          {canCreate ? (
            <Button asChild size="sm">
              <Link href="/app/schedule/new">New shift</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/locations">Add a location first</Link>
            </Button>
          )}
        </div>
      </div>

      {showCopyFlash && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          {copiedCount > 0 ? (
            <>
              Copied {copiedCount} shift{copiedCount === 1 ? "" : "s"} as
              drafts.
              {skippedCount > 0 && (
                <span className="text-ink-2">
                  {" "}
                  Skipped {skippedCount} that already had a matching shift.
                </span>
              )}{" "}
              {assignedCount > 0 && (
                <span className="text-ink-2">
                  {" "}
                  Carried {assignedCount} staff assignment
                  {assignedCount === 1 ? "" : "s"}.
                </span>
              )}{" "}
              Review and publish when ready.
            </>
          ) : (
            <>
              No new shifts to copy — every slot was already filled
              {skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : ""}.
            </>
          )}
        </div>
      )}

      {flaggedCount > 0 && (
        <div className="rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--destructive)_45%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-4 py-2 text-sm font-medium text-ink">
          ⚠ {flaggedCount} assignment{flaggedCount === 1 ? "" : "s"} couldn&rsquo;t
          be carried — those staff are unavailable or on approved leave that
          week. Those shifts were left unfilled. Re-copy with{" "}
          <span className="font-semibold">&ldquo;assign even if unavailable&rdquo;</span>{" "}
          to override, or fill them manually.
        </div>
      )}

      {locations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Location:
          </span>
          <Button
            asChild
            size="sm"
            variant={locationFilter ? "outline" : "default"}
          >
            <Link href={`/app/schedule${qs({ location: null })}`}>All</Link>
          </Button>
          {locations.map((loc) => (
            <Button
              asChild
              key={loc.id}
              size="sm"
              variant={locationFilter === loc.id ? "default" : "outline"}
            >
              <Link
                href={`/app/schedule${qs({ location: loc.id })}`}
                className="inline-flex items-center gap-1.5"
              >
                {loc.color && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: loc.color }}
                  />
                )}
                {loc.name}
              </Link>
            </Button>
          ))}
        </div>
      )}

      {labourForecast && (
        <WeeklyLabourForecast forecast={labourForecast} />
      )}

      {employeeFilter && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--accent-deep)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent-deep)_10%,transparent)] px-4 py-2 text-sm">
          <span className="font-medium text-ink">
            Showing{" "}
            {employees.find((e) => e.appUserId === employeeFilter)?.fullName ??
              "this employee"}
            ’s shifts
          </span>
          <Link
            href={`/app/schedule${qs({ employee: null })}`}
            className="text-xs text-muted-foreground hover:text-ink hover:underline"
          >
            Clear filter
          </Link>
        </div>
      )}

      {isAdmin && (
        <RepublishBanner
          count={editedSincePublishCount}
          weekStartIso={weekStart.toISOString()}
          weekEndIso={weekEnd.toISOString()}
          location={locationFilter || undefined}
        />
      )}

      {view === "area" ? (
        <AreaScheduleView
          weekStartMs={weekStart.getTime()}
          dayCount={dayCount}
          shifts={shifts.map((s) => ({
            ...s,
            needsPublish: needsPublish(s),
            startsAtMs: s.startsAt.getTime(),
            endsAtMs: s.endsAt.getTime(),
          })) as unknown as AreaShiftSer[]}
          employees={employees}
        />
      ) : view === "employee" ? (
        <EmployeeScheduleView
          weekStart={weekStart}
          dayCount={dayCount}
          shifts={shifts.map((s) => ({
            ...s,
            needsPublish: needsPublish(s),
          })) as unknown as AreaShift[]}
          employees={employees as EmployeeRow[]}
          assignmentsByShift={assignmentsByShift}
        />
      ) : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => (
          <section
            key={d.date.toISOString()}
            className="rounded-[var(--r-lg)] border border-line bg-[var(--paper)] shadow-[var(--shadow-sm)]"
          >
            <div className="border-b border-line-soft px-4 py-2.5 font-display text-sm font-semibold tracking-[-0.01em] text-ink">
              {fmtDayHeader(d.date)}
            </div>
            {d.shifts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-ink-3">No shifts</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {d.shifts.map((s) => (
                  <li
                    key={s.id}
                    className="relative px-4 py-3"
                    style={
                      s.locationColor
                        ? { boxShadow: `inset 3px 0 0 ${s.locationColor}` }
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium text-ink">
                          {s.locationColor && (
                            <span
                              aria-hidden
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: s.locationColor }}
                            />
                          )}
                          <span className="font-mono tabular-nums">
                            {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)}
                          </span>
                          <span className="text-ink-2">· {s.role}</span>
                        </div>
                        <div className="truncate text-xs text-ink-2">
                          {s.locationName ?? "—"}
                          {" · "}
                          {s.acceptedCount} accepted
                          {s.offeredCount > 0 ? ` · ${s.offeredCount} pending` : ""}
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANT[s.status] ?? "neutral"} size="sm">
                        {s.status}
                      </Badge>
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/app/schedule/${s.id}/edit`}
                        className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-2 hover:text-ink"
                      >
                        Edit →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      )}

      {/* ─── Bottom status strip ─── */}
      <section className="rounded-[var(--r-lg)] border border-line bg-[var(--paper)] px-4 py-3 shadow-[var(--shadow-sm)]">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <StatusPill
            label="Published"
            value={stripCounts.published}
            tone={stripCounts.published > 0 ? "emerald" : "muted"}
          />
          <StatusPill
            label="Draft"
            value={stripCounts.draft}
            tone={stripCounts.draft > 0 ? "amber" : "muted"}
          />
          <StatusPill
            label="Open"
            value={stripCounts.open}
            tone={stripCounts.open > 0 ? "amber" : "muted"}
          />
          <StatusPill
            label="Cancelled"
            value={stripCounts.cancelled}
            tone={stripCounts.cancelled > 0 ? "rose" : "muted"}
          />
          <span className="hidden h-3 border-r border-line sm:block" />
          <StatusPill
            label="Swaps pending"
            value={stripCounts.swapsPending}
            tone={stripCounts.swapsPending > 0 ? "blue" : "muted"}
          />
          <StatusPill
            label="Leave pending"
            value={stripCounts.leavePending}
            tone={stripCounts.leavePending > 0 ? "amber" : "muted"}
          />
          <StatusPill
            label="Leave approved"
            value={stripCounts.leaveApprovedThisWeek}
            tone={stripCounts.leaveApprovedThisWeek > 0 ? "blue" : "muted"}
          />
        </ul>
      </section>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "blue" | "muted";
}) {
  const dot: Record<typeof tone, string> = {
    emerald: "var(--live)",
    amber: "var(--warn)",
    rose: "var(--danger)",
    blue: "var(--accent-deep)",
    muted: "var(--ink-3)",
  };
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: dot[tone] }}
      />
      <span className="font-mono font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-ink-2">{label}</span>
    </li>
  );
}
