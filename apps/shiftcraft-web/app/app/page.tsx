import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, eq, gte, lte, sql } from "drizzle-orm";
import { CalendarCheck, CalendarDays, Clock, Plane } from "lucide-react";
import {
  forTenant,
  scClockEvents,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftSwapRequests,
  scTimeOffRequests,
  scTimesheetApprovals,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { deriveClockState, getTodayEventsForUser } from "~/lib/clock";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Eyebrow } from "~/components/ui/card";
import { InfoPopover } from "~/components/InfoPopover";
import { ShiftHero } from "~/components/ShiftHero";
import { StatTile } from "~/components/StatTile";

// Dashboard ("/app") — Deputy-style "Me" view, "command center" layout.
//
// Live shift hero (driven by the actual open clock-in) + 2×2 quick actions,
// a 4-across stat row, and a horizontal week strip. All queries are scoped
// per-tenant via forTenant. Admin-only sections are skipped at fetch time for
// members (zero wasted round-trips).

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

const STATUS_VARIANT: Record<string, "live" | "warn" | "neutral" | "open" | "danger"> = {
  accepted: "live",
  offered: "warn",
  declined: "neutral",
  swapped: "open",
  no_show: "danger",
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
    // Signed in but no workspace yet — send them to self-service onboarding
    // to create one (provisions a full per-tenant ShiftCraft schema).
    redirect("/onboarding");
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

  // ─── Today's shift (feeds the hero) ───
  const myShiftsToday = myWeekShifts.filter(
    (s) => s.startsAt >= today && s.startsAt < tomorrow,
  );

  // ─── Live shift hero source: the user's actual open clock-in. Reuse the
  //     clock state machine — the latest 'in' event opens the current session
  //     (breaks don't re-emit 'in'), so it is the session start. ───
  const todayEvents = await getTodayEventsForUser(tenantId, user.id);
  const clockState = deriveClockState(todayEvents);
  const clockedInAtMs =
    clockState.status !== "clocked_out"
      ? (todayEvents
          .filter((e) => e.eventType === "in")
          .at(-1)
          ?.occurredAt.getTime() ?? null)
      : null;

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

  // ─── What's happening: people on leave today or in next 14 days (count) ───
  const peopleOnLeave = await ctx.run((tx) =>
    tx
      .select({
        id: scTimeOffRequests.id,
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
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

  const prevWeek = addDays(weekStart, -7).toISOString().slice(0, 10);
  const nextWeek = addDays(weekStart, 7).toISOString().slice(0, 10);
  const isCurrentWeek = weekStart.getTime() === todayMidnight.getTime();

  // Weekly totals for the strip + the member "This week" tile.
  const weekTotalMs = myWeekShifts
    .filter((s) => s.status === "accepted" || s.status === "offered")
    .reduce(
      (acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()),
      0,
    );
  const weekShiftCount = myWeekShifts.filter(
    (s) => s.status === "accepted",
  ).length;

  // Per-day hours (Mon→Sun) — sparkline for the member "This week" tile.
  // Derived from the already-fetched week shifts, no extra query.
  const weekDayHours = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    const dayEnd = addDays(day, 1);
    const ms = myWeekShifts
      .filter((s) => s.startsAt >= day && s.startsAt < dayEnd)
      .reduce((acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()), 0);
    return Math.round((ms / 3_600_000) * 10) / 10;
  });

  const today0 = myShiftsToday[0];
  const attentionCount = upcomingTimeOff.length + (isAdmin ? openSwapRequests[0]!.n : 0);

  const QUICK_ACTIONS = [
    { href: "/app/clock", label: "Time clock", Icon: Clock, primary: true },
    { href: "/app/schedule", label: "Open roster", Icon: CalendarDays },
    { href: "/app/time-off", label: "Request time off", Icon: Plane },
    { href: "/app/availability", label: "My availability", Icon: CalendarCheck },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-8">
      {/* ─── Header ─── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>
            {today.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </Eyebrow>
          <h1 className="mt-1 flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            {(() => {
              const h = new Date().getHours();
              const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
              const first = user.name ? `, ${user.name.split(" ")[0]}` : "";
              return `Good ${part}${first}.`;
            })()}
            <InfoPopover label="About the dashboard">
              <p>
                Your live command center: today&rsquo;s shift status, quick
                actions, and (for managers) what needs attention + approval.
                The tiles below pull live from the schedule, timesheets, and
                clock activity.
              </p>
            </InfoPopover>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/schedule">Open roster</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/app/clock">Time clock</Link>
          </Button>
        </div>
      </header>

      {/* ─── Hero + quick actions ─── */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ShiftHero
          name={user.name ?? user.email ?? "You"}
          email={user.email ?? ""}
          image={user.image ?? null}
          shiftStartMs={today0 ? today0.startsAt.getTime() : null}
          shiftEndMs={today0 ? today0.endsAt.getTime() : null}
          role={today0?.role ?? null}
          locationName={today0?.locationName ?? null}
          clockedInAtMs={clockedInAtMs}
        />
        <div className="grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map((qa) => (
            <Button
              key={qa.href}
              asChild
              variant={qa.primary ? "default" : "outline"}
              className="h-auto flex-col items-center justify-center gap-1.5 py-5 transition-transform hover:-translate-y-0.5"
            >
              <Link href={qa.href}>
                <qa.Icon />
                <span>{qa.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      </div>

      {/* ─── Stat tiles ─── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isAdmin ? (
          <>
            <StatTile
              label="Needs attention"
              value={attentionCount}
              tone="live"
              hint={attentionCount === 0 ? "All clear" : "Next 7 days"}
            />
            <StatTile
              label="Leave requests"
              value={pendingLeaveCount}
              hint="Pending review"
              href="/app/time-off"
            />
            <StatTile
              label="Timesheets"
              value={timesheetsNeedingApproval}
              tone="warn"
              hint="Awaiting sign-off"
              href="/app/timesheets"
            />
            <StatTile
              label="On leave (2 wks)"
              value={peopleOnLeave.length}
            />
          </>
        ) : (
          <>
            <StatTile
              label="This week"
              value={fmtDuration(weekTotalMs)}
              trend={weekDayHours}
            />
            <StatTile label="Shifts this week" value={weekShiftCount} />
            <StatTile
              label="Today"
              value={myShiftsToday.length}
              hint={myShiftsToday.length === 1 ? "1 shift" : "shifts"}
            />
            <StatTile
              label="Time off booked"
              value={upcomingTimeOff.length}
              tone="live"
              hint={upcomingTimeOff.length === 0 ? "None upcoming" : "Next 7 days"}
            />
          </>
        )}
      </div>

      {/* ─── This week strip ─── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-tight text-ink">
            This week
          </h2>
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
          <p className="text-xs text-ink-3">
            Weekly total: {weekShiftCount} shift{weekShiftCount === 1 ? "" : "s"}
            {" · "}
            {fmtDuration(weekTotalMs)}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-2">
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
                  className={`flex min-h-[8.5rem] flex-col rounded-lg border bg-card p-2 shadow-sm ${
                    isToday
                      ? "border-[var(--ink)] ring-1 ring-[var(--ink)]"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 border-b border-line-soft pb-1.5">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                      {label.weekday} {label.day}
                    </span>
                    {isToday ? (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 animate-[sc-pulse_1.8s_infinite] rounded-full bg-[var(--live)]"
                      />
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-1 flex-col gap-1.5">
                    {dayShifts.length === 0 ? (
                      <span className="text-[10px] italic text-ink-3/60">—</span>
                    ) : (
                      dayShifts.map((s) => {
                        const dur = s.endsAt.getTime() - s.startsAt.getTime();
                        if (s.status === "accepted") {
                          return (
                            <div
                              key={s.id}
                              className="space-y-0.5 rounded-md bg-[var(--live)] px-1.5 py-1 text-[10px] text-white"
                            >
                              <div className="font-mono font-semibold tabular-nums">
                                {fmtTimeRange(s.startsAt, s.endsAt)}
                              </div>
                              {s.role ? (
                                <div className="truncate opacity-90">
                                  {s.role}
                                </div>
                              ) : null}
                              <div className="font-mono opacity-80">
                                {fmtDuration(dur)}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={s.id}
                            className="space-y-1 rounded-md border border-border bg-background px-1.5 py-1 text-[10px]"
                          >
                            <div className="font-mono tabular-nums text-ink">
                              {fmtTimeRange(s.startsAt, s.endsAt)}
                            </div>
                            <Badge
                              variant={STATUS_VARIANT[s.status] ?? "neutral"}
                              size="sm"
                            >
                              {STATUS_LABEL[s.status] ?? s.status}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
