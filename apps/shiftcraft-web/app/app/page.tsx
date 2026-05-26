import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scClockEvents,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  scTimeOffRequests,
  scTimesheetApprovals,
  users as appUsers,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

// Dashboard ("/app") — Deputy-style "Me" view.
//
// Left rail: profile + today's shift status + Start-unscheduled-shift CTA.
// Three cards: Needs Attention / Needs Approval (admin) / What's happening?
// Calendar strip: current user's week of shifts with day-card grid.
//
// All queries are scoped per-tenant via forTenant. Admin-only sections
// are skipped at fetch time for members (zero wasted round-trips).

function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
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

function fmtDayLabel(d: Date): { weekday: string; day: number } {
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    day: d.getDate(),
  };
}

function fmtTimeRange(start: Date, end: Date): string {
  const fmt = (x: Date) =>
    x.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${fmt(start)} - ${fmt(end)}`;
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "0h 0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function fmtDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const e = end.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (s === e) return s;
  return `${s} → ${e}`;
}

const STATUS_BADGE: Record<string, string> = {
  accepted: "bg-emerald-600 text-white",
  offered: "bg-amber-500 text-white",
  declined: "bg-slate-500 text-white",
  swapped: "bg-blue-600 text-white",
  no_show: "bg-rose-600 text-white",
};

const STATUS_LABEL: Record<string, string> = {
  accepted: "Approved",
  offered: "Offered",
  declined: "Declined",
  swapped: "Swapped",
  no_show: "No-show",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await currentUser();
  if (!user) return null;
  const membership = await currentMembership();

  if (!membership) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight">
          Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}.
          <InfoPopover label="About this screen">
            <p>
              You&rsquo;re signed in but not attached to a ShiftCraft
              workspace yet. Set one up from the LMS to unlock scheduling,
              timesheets, and clock-in.
            </p>
          </InfoPopover>
        </h1>
        <p className="mt-2 text-muted-foreground">
          You're signed in. Set up a workspace from the LMS to start using
          ShiftCraft features.
        </p>
      </div>
    );
  }

  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const tenantId = membership.tenant.id;

  // AUDIT.md #2 polish — worker-side onboarding redirect. If the
  // signed-in user has a sc_employees row whose onboarding_status is
  // still 'pending' (never opened the welcome page), redirect there
  // so they finish before seeing the dashboard. Admins and rosterless
  // users skip — only workers attached to a roster row get the
  // forcing function.
  const [selfEmployee] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        onboardingStatus: scEmployees.onboardingStatus,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.appUserId, user.id),
        ),
      )
      .limit(1),
  );
  if (selfEmployee && selfEmployee.onboardingStatus === "pending") {
    redirect("/app/welcome");
  }
  const sp = await searchParams;
  const requestedWeek = sp.week ? new Date(sp.week) : null;
  const baseDay =
    requestedWeek && !Number.isNaN(requestedWeek.getTime())
      ? requestedWeek
      : new Date();
  const weekStart = startOfWeek(baseDay);
  const weekEnd = addDays(weekStart, 7);
  const todayMidnight = startOfWeek(new Date());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);
  const sevenDaysOut = addDays(today, 7);
  const fourteenDaysOut = addDays(today, 14);

  const ctx = forTenant(tenantId);

  // ─── My week (calendar strip) ───
  const myWeekShifts = await ctx.run((tx) =>
    tx
      .select({
        id: scShiftAssignments.id,
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
          eq(scShiftAssignments.userId, user.id),
          eq(scShifts.traceyTenantId, tenantId),
          gte(scShifts.startsAt, weekStart),
          lte(scShifts.startsAt, weekEnd),
        ),
      )
      .orderBy(asc(scShifts.startsAt)),
  );

  // ─── Profile rail: today's shift status ───
  const myShiftsToday = myWeekShifts.filter(
    (s) => s.startsAt >= today && s.startsAt < tomorrow,
  );

  // ─── Needs Attention: upcoming approved time off (everyone sees their own;
  //     admin sees the whole tenant for next-7-day awareness). Also includes
  //     pending swap requests for admin. ───
  const upcomingTimeOff = await ctx.run((tx) =>
    tx
      .select({
        id: scTimeOffRequests.id,
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
        reason: scTimeOffRequests.reason,
      })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.status, "approved"),
          gte(scTimeOffRequests.startDate, today.toISOString().slice(0, 10)),
          lte(scTimeOffRequests.startDate, sevenDaysOut.toISOString().slice(0, 10)),
          isAdmin
            ? sql`1=1`
            : eq(scTimeOffRequests.userId, user.id),
        ),
      )
      .orderBy(asc(scTimeOffRequests.startDate)),
  );

  const openSwapRequests = isAdmin
    ? await ctx.run((tx) =>
        tx
          .select({ n: count() })
          .from(scShiftSwapRequests)
          .where(
            and(
              eq(scShiftSwapRequests.traceyTenantId, tenantId),
              eq(scShiftSwapRequests.status, "pending"),
            ),
          ),
      )
    : [{ n: 0 }];

  // ─── Needs Approval (admin): pending leave + weeks awaiting timesheet
  //     approval (count distinct employee-weeks in last 4 weeks that have
  //     clock activity but no scTimesheetApprovals row). ───
  const pendingLeaveCount = isAdmin
    ? (
        await ctx.run((tx) =>
          tx
            .select({ n: count() })
            .from(scTimeOffRequests)
            .where(
              and(
                eq(scTimeOffRequests.traceyTenantId, tenantId),
                eq(scTimeOffRequests.status, "pending"),
              ),
            ),
        )
      )[0]?.n ?? 0
    : 0;

  // For timesheets: derive list of (employee_user_id, week_start) with
  // activity in the last 4 weeks, then subtract those that already have an
  // approval row. Cheap because the window is small.
  let timesheetsNeedingApproval = 0;
  if (isAdmin) {
    const fourWeeksAgo = startOfWeek(addDays(today, -28));
    const activityRows = await ctx.run((tx) =>
      tx
        .select({
          userId: scClockEvents.appUserId,
          weekStart: sql<string>`to_char(date_trunc('week', ${scClockEvents.occurredAt}), 'YYYY-MM-DD')`.as(
            "week_start",
          ),
        })
        .from(scClockEvents)
        .where(
          and(
            eq(scClockEvents.traceyTenantId, tenantId),
            gte(scClockEvents.occurredAt, fourWeeksAgo),
          ),
        )
        .groupBy(
          scClockEvents.appUserId,
          sql`date_trunc('week', ${scClockEvents.occurredAt})`,
        ),
    );
    const approvedRows = await ctx.run((tx) =>
      tx
        .select({
          userId: scTimesheetApprovals.employeeUserId,
          weekStart: scTimesheetApprovals.weekStart,
        })
        .from(scTimesheetApprovals)
        .where(
          and(
            eq(scTimesheetApprovals.traceyTenantId, tenantId),
            gte(scTimesheetApprovals.weekStart, fourWeeksAgo.toISOString().slice(0, 10)),
          ),
        ),
    );
    const approvedKey = new Set(
      approvedRows.map((r) => `${r.userId}:${r.weekStart}`),
    );
    timesheetsNeedingApproval = activityRows.filter(
      (r) => !approvedKey.has(`${r.userId}:${r.weekStart}`),
    ).length;
  }

  // ─── What's happening: people on leave today or in next 14 days ───
  const peopleOnLeave = await ctx.run((tx) =>
    tx
      .select({
        id: scTimeOffRequests.id,
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
        reason: scTimeOffRequests.reason,
      })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.traceyTenantId, tenantId),
          eq(scTimeOffRequests.status, "approved"),
          lte(scTimeOffRequests.startDate, fourteenDaysOut.toISOString().slice(0, 10)),
          gte(scTimeOffRequests.endDate, today.toISOString().slice(0, 10)),
        ),
      )
      .orderBy(asc(scTimeOffRequests.startDate))
      .limit(8),
  );

  // Resolve names for everyone surfaced across the cards (one round-trip).
  const userIdsToResolve = Array.from(
    new Set<string>([
      ...upcomingTimeOff.map((t) => t.userId),
      ...peopleOnLeave.map((t) => t.userId),
    ]),
  );
  const profileRows = userIdsToResolve.length === 0
    ? []
    : await db
        .select({
          id: appUsers.id,
          name: appUsers.name,
          email: appUsers.email,
          image: appUsers.image,
        })
        .from(appUsers)
        .innerJoin(members, eq(members.userId, appUsers.id))
        .where(
          and(
            eq(members.tenantId, tenantId),
            inArray(appUsers.id, userIdsToResolve),
          ),
        );
  const profileById = new Map(profileRows.map((p) => [p.id, p]));

  // ─── Birthdays this week (uses the new sc_employees.date_of_birth) ───
  const birthdaysThisWeek = await ctx.run((tx) =>
    tx
      .select({
        id: scEmployees.id,
        fullName: scEmployees.fullName,
        dateOfBirth: scEmployees.dateOfBirth,
        appUserId: scEmployees.appUserId,
        email: scEmployees.email,
      })
      .from(scEmployees)
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          sql`${scEmployees.dateOfBirth} is not null`,
          sql`to_char(${scEmployees.dateOfBirth}, 'MM-DD') between to_char(${weekStart.toISOString().slice(0, 10)}::date, 'MM-DD') and to_char(${addDays(weekStart, 6).toISOString().slice(0, 10)}::date, 'MM-DD')`,
        ),
      )
      .limit(5),
  );

  const prevWeek = addDays(weekStart, -7).toISOString().slice(0, 10);
  const nextWeek = addDays(weekStart, 7).toISOString().slice(0, 10);
  const isCurrentWeek = weekStart.getTime() === todayMidnight.getTime();

  // Weekly totals for the calendar strip footer.
  const weekTotalMs = myWeekShifts
    .filter((s) => s.status === "accepted" || s.status === "offered")
    .reduce(
      (acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()),
      0,
    );
  const weekShiftCount = myWeekShifts.filter(
    (s) => s.status === "accepted",
  ).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {/* ─── Left profile rail ─── */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-card p-6 text-center shadow-sm">
            <Avatar
              name={user.name ?? user.email ?? "?"}
              email={user.email ?? ""}
              image={user.image ?? null}
              sizeClass="h-24 w-24 mx-auto"
              textClass="text-3xl"
            />
            <div className="mt-4 text-sm font-semibold">
              {user.name ?? user.email}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {myShiftsToday.length === 0
                ? "No scheduled shifts today"
                : myShiftsToday.length === 1
                  ? `Working ${fmtTimeRange(myShiftsToday[0]!.startsAt, myShiftsToday[0]!.endsAt)}`
                  : `${myShiftsToday.length} shifts today`}
            </div>
            <Button asChild className="mt-4 w-full">
              <Link href="/app/clock">
                {myShiftsToday.length > 0
                  ? "Open time clock"
                  : "Start unscheduled shift"}
              </Link>
            </Button>
          </div>
          <nav className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Jump to
            </div>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href="/app/my-shifts"
                  className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  My shifts
                </Link>
              </li>
              <li>
                <Link
                  href="/app/time-off"
                  className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Request time off
                </Link>
              </li>
              <li>
                <Link
                  href="/app/availability"
                  className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  My availability
                </Link>
              </li>
              <li>
                <Link
                  href="/app/open-shifts"
                  className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Open shifts
                </Link>
              </li>
            </ul>
          </nav>
        </aside>

        {/* ─── Main column ─── */}
        <div className="space-y-6">
          <header className="flex items-center justify-between">
            <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
              Dashboard
              <InfoPopover label="About the dashboard">
                <p>
                  Daily roundup: today&rsquo;s shift status, recent
                  announcements, and (for managers) what needs attention
                  + approval. The cards below pull live from the schedule,
                  timesheets, and notifications.
                </p>
              </InfoPopover>
            </h1>
            <div className="text-xs text-muted-foreground">
              {membership.tenant.name}
            </div>
          </header>

          {/* ─── Three cards ─── */}
          <div className={`grid gap-4 ${isAdmin ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
            {/* Needs Attention */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Needs Attention
              </h2>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
                {upcomingTimeOff.length === 0 && (!isAdmin || openSwapRequests[0]!.n === 0) ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing flagged for the next 7 days.
                  </p>
                ) : (
                  <>
                    {upcomingTimeOff.length > 0 ? (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Upcoming time off ({upcomingTimeOff.length})
                        </div>
                        <ul className="mt-1 space-y-1">
                          {upcomingTimeOff.slice(0, 4).map((t) => {
                            const p = profileById.get(t.userId);
                            return (
                              <li
                                key={t.id}
                                className="flex items-center gap-2 text-xs"
                              >
                                <Avatar
                                  name={p?.name ?? p?.email ?? "?"}
                                  email={p?.email ?? ""}
                                  image={p?.image ?? null}
                                  sizeClass="h-6 w-6"
                                  textClass="text-[10px]"
                                />
                                <span className="truncate font-medium">
                                  {p?.name ?? p?.email ?? "Unknown"}
                                </span>
                                <span className="text-muted-foreground">
                                  {fmtDateRange(
                                    new Date(t.startDate),
                                    new Date(t.endDate),
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : null}
                    {isAdmin && openSwapRequests[0]!.n > 0 ? (
                      <Link
                        href="/app/swaps"
                        className="block rounded-md border border-border bg-background px-3 py-2 text-xs hover:bg-muted"
                      >
                        <span className="font-semibold">
                          {openSwapRequests[0]!.n}
                        </span>{" "}
                        open shift swap{openSwapRequests[0]!.n === 1 ? "" : "s"} →
                      </Link>
                    ) : null}
                  </>
                )}
              </div>
            </section>

            {/* Needs Approval (admin only) */}
            {isAdmin ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold tracking-tight">
                  Needs Approval
                </h2>
                <div className="space-y-2">
                  <Link
                    href="/app/time-off"
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-muted/40"
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {pendingLeaveCount === 0
                          ? "No leave requests"
                          : `${pendingLeaveCount} leave request${pendingLeaveCount === 1 ? "" : "s"}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pending review
                      </div>
                    </div>
                    <span className="text-muted-foreground">→</span>
                  </Link>
                  <Link
                    href="/app/timesheets"
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm hover:bg-muted/40"
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {timesheetsNeedingApproval === 0
                          ? "All timesheets approved"
                          : `${timesheetsNeedingApproval} timesheet${timesheetsNeedingApproval === 1 ? "" : "s"}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last 4 weeks awaiting sign-off
                      </div>
                    </div>
                    <span className="text-muted-foreground">→</span>
                  </Link>
                </div>
              </section>
            ) : null}

            {/* What's happening */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-tight">
                What's happening?
              </h2>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm">
                {peopleOnLeave.length === 0 && birthdaysThisWeek.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    All quiet in the next two weeks.
                  </p>
                ) : null}
                {peopleOnLeave.length > 0 ? (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {peopleOnLeave.length}{" "}
                      {peopleOnLeave.length === 1 ? "person" : "people"} on leave
                    </div>
                    <ul className="mt-1 space-y-1.5">
                      {peopleOnLeave.map((t) => {
                        const p = profileById.get(t.userId);
                        return (
                          <li
                            key={t.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Avatar
                              name={p?.name ?? p?.email ?? "?"}
                              email={p?.email ?? ""}
                              image={p?.image ?? null}
                              sizeClass="h-6 w-6"
                              textClass="text-[10px]"
                            />
                            <span className="truncate font-medium">
                              {p?.name ?? p?.email ?? "Unknown"}
                            </span>
                            <span className="text-muted-foreground">
                              {fmtDateRange(
                                new Date(t.startDate),
                                new Date(t.endDate),
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {birthdaysThisWeek.length > 0 ? (
                  <div className="pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Birthdays this week
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {birthdaysThisWeek.map((b) => (
                        <li key={b.id}>
                          🎂 <span className="font-medium">{b.fullName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* ─── Calendar strip ─── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">Calendar</h2>
              <div className="flex items-center gap-2 text-sm">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app?week=${prevWeek}`}>←</Link>
                </Button>
                <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
                  {weekStart.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                  {" – "}
                  {addDays(weekStart, 6).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/app?week=${nextWeek}`}>→</Link>
                </Button>
                {!isCurrentWeek ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/app">Today</Link>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/app/my-shifts">Upcoming shifts</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/app/open-shifts">Available shifts</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/app/time-off">Request time off</Link>
              </Button>
            </div>

            {weekShiftCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                Weekly total: {weekShiftCount} shift{weekShiftCount === 1 ? "" : "s"}
                {" · "}
                {fmtDuration(weekTotalMs)}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {Array.from({ length: 7 }).map((_, i) => {
                const day = addDays(weekStart, i);
                const dayEnd = addDays(day, 1);
                const isToday = day.getTime() === today.getTime();
                const label = fmtDayLabel(day);
                const dayShifts = myWeekShifts.filter(
                  (s) => s.startsAt >= day && s.startsAt < dayEnd,
                );
                return (
                  <div
                    key={i}
                    className={`flex min-h-[10rem] flex-col rounded-lg border bg-card p-3 shadow-sm ${
                      isToday ? "border-primary" : "border-border"
                    }`}
                  >
                    <div
                      className={`flex items-baseline gap-1 border-b pb-1 ${
                        isToday ? "border-primary" : "border-border"
                      }`}
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {label.weekday}
                      </span>
                      <span className="text-base font-semibold">
                        {label.day}
                      </span>
                      {isToday ? (
                        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-primary">
                          Today
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-1 flex-col gap-1.5">
                      {dayShifts.length === 0 ? (
                        <span className="text-[10px] italic text-muted-foreground/60">
                          —
                        </span>
                      ) : (
                        dayShifts.map((s) => {
                          const mins =
                            (s.endsAt.getTime() - s.startsAt.getTime()) /
                            60_000;
                          const h = Math.floor(mins / 60);
                          const m = Math.round(mins % 60);
                          return (
                            <div
                              key={s.id}
                              className="space-y-0.5 rounded-md border border-border bg-background p-2 text-[11px]"
                            >
                              <div className="font-mono font-semibold tabular-nums">
                                {fmtTimeRange(s.startsAt, s.endsAt)}
                              </div>
                              {s.role ? (
                                <div className="truncate text-muted-foreground">
                                  {s.role}
                                </div>
                              ) : null}
                              {s.locationName ? (
                                <div className="truncate text-muted-foreground">
                                  {s.locationName}
                                </div>
                              ) : null}
                              <div className="flex items-center justify-between pt-1">
                                <span className="text-muted-foreground">
                                  {h}h {m}m
                                </span>
                                <span
                                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${STATUS_BADGE[s.status] ?? "bg-muted text-muted-foreground"}`}
                                >
                                  {STATUS_LABEL[s.status] ?? s.status}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
