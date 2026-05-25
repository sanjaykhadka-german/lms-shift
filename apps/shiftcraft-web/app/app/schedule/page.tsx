import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, between, count, eq, gte, lte, sql } from "drizzle-orm";
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
import { WeeklyLabourForecast } from "~/components/WeeklyLabourForecast";
import { AreaScheduleView, type AreaShift } from "./_area-view";
import { EmployeeScheduleView, type EmployeeRow } from "./_employee-view";
import { bulkPublishWeekAction, duplicateWeekAction } from "./actions";

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

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-500 text-white",
  published: "bg-emerald-600 text-white",
  cancelled: "bg-rose-600 text-white line-through",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    week?: string;
    location?: string;
    view?: string;
    copied?: string;
    skipped?: string;
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
    copied,
    skipped,
  } = await searchParams;
  const view: ScheduleView =
    viewRaw === "area" ? "area" : viewRaw === "employee" ? "employee" : "day";
  const copiedCount = Number.parseInt(copied ?? "", 10);
  const skippedCount = Number.parseInt(skipped ?? "", 10);
  const showCopyFlash = Number.isFinite(copiedCount) && copied !== undefined;
  const anchor = week ? new Date(`${week}T00:00:00`) : new Date();
  const weekStart = startOfWeek(isNaN(anchor.getTime()) ? new Date() : anchor);
  const weekEnd = addDays(weekStart, 7); // exclusive

  const qs = (overrides: {
    week?: string;
    location?: string | null;
    view?: ScheduleView | null;
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
    if (v && v !== "day") params.set("view", v);
    const s = params.toString();
    return s ? `?${s}` : "";
  };

  const prevWeek = fmtIsoDate(addDays(weekStart, -7));
  const nextWeek = fmtIsoDate(addDays(weekStart, 7));
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
            scopeIds
              ? sql`${scShifts.locationId} = ANY(${scopeIds})`
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
            scopeIds
              ? sql`${scLocations.id} = ANY(${scopeIds})`
              : undefined,
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
            sql`${scShiftAssignments.shiftId} = ANY(${shiftIds})`,
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
  const weekEndInclusiveIso = fmtIsoDate(addDays(weekStart, 6));
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

  // Group shifts by day index (0=Mon … 6=Sun).
  const days: Array<{ date: Date; shifts: typeof shifts }> = Array.from(
    { length: 7 },
    (_, i) => ({ date: addDays(weekStart, i), shifts: [] }),
  );
  for (const s of shifts) {
    const idx = Math.floor((s.startsAt.getTime() - weekStart.getTime()) / 86400000);
    const day = days[idx];
    if (day) day.shifts.push(s);
  }

  const canCreate = locations.length > 0;
  const isAdmin = membership.role === "admin" || membership.role === "owner";
  const draftCount = shifts.filter((s) => s.status === "draft").length;
  const labourForecast = isAdmin
    ? await forecastWeek(membership.tenant.id, weekStart, weekEnd)
    : null;
  const activeLocation = locationFilter
    ? locations.find((l) => l.id === locationFilter)
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtRange(weekStart, addDays(weekStart, 6))} ·{" "}
            {shifts.length} shift{shifts.length === 1 ? "" : "s"}
            {activeLocation ? ` · ${activeLocation.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-1 inline-flex overflow-hidden rounded-md border border-border">
            <Link
              href={`/app/schedule${qs({ view: "day" })}`}
              className={`px-3 py-1.5 text-xs font-medium ${
                view === "day"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Day
            </Link>
            <Link
              href={`/app/schedule${qs({ view: "area" })}`}
              className={`px-3 py-1.5 text-xs font-medium ${
                view === "area"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Area
            </Link>
            <Link
              href={`/app/schedule${qs({ view: "employee" })}`}
              className={`px-3 py-1.5 text-xs font-medium ${
                view === "employee"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              Employee
            </Link>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: prevWeek })}`}>← Prev</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: thisWeek })}`}>Today</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/schedule${qs({ week: nextWeek })}`}>Next →</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/schedule/export?from=${fmtIsoDate(weekStart)}&to=${fmtIsoDate(weekEnd)}${locationFilter ? `&location=${locationFilter}` : ""}`}
            >
              Export CSV
            </a>
          </Button>
          {isAdmin && draftCount > 0 && (
            <form action={bulkPublishWeekAction}>
              <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
              <input type="hidden" name="weekEnd" value={weekEnd.toISOString()} />
              {locationFilter && (
                <input type="hidden" name="location" value={locationFilter} />
              )}
              <Button type="submit" variant="outline" size="sm">
                Publish {draftCount} draft{draftCount === 1 ? "" : "s"}
              </Button>
            </form>
          )}
          {isAdmin && shifts.length > 0 && (
            <form action={duplicateWeekAction}>
              <input
                type="hidden"
                name="weekStart"
                value={weekStart.toISOString()}
              />
              {locationFilter && (
                <input type="hidden" name="location" value={locationFilter} />
              )}
              <Button type="submit" variant="outline" size="sm">
                Copy to next week
              </Button>
            </form>
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
        <div className="rounded-md border-2 border-emerald-500/60 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/50 dark:text-emerald-100">
          {copiedCount > 0 ? (
            <>
              Copied {copiedCount} shift{copiedCount === 1 ? "" : "s"} into
              this week as drafts.
              {skippedCount > 0 && (
                <span className="text-emerald-800/80 dark:text-emerald-200/80">
                  {" "}
                  Skipped {skippedCount} that already had a matching shift.
                </span>
              )}{" "}
              Review and publish when ready.
            </>
          ) : (
            <>
              No new shifts to copy — this week already has every slot that
              last week did
              {skippedCount > 0 ? ` (${skippedCount} duplicates skipped)` : ""}.
            </>
          )}
        </div>
      )}

      {locations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
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

      {view === "area" ? (
        <AreaScheduleView
          weekStart={weekStart}
          shifts={shifts as unknown as AreaShift[]}
          employees={employees}
        />
      ) : view === "employee" ? (
        <EmployeeScheduleView
          weekStart={weekStart}
          shifts={shifts as unknown as AreaShift[]}
          employees={employees as EmployeeRow[]}
          assignmentsByShift={assignmentsByShift}
        />
      ) : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => (
          <section
            key={d.date.toISOString()}
            className="rounded-lg border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border px-4 py-2 text-sm font-medium">
              {fmtDayHeader(d.date)}
            </div>
            {d.shifts.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground">No shifts</p>
            ) : (
              <ul className="divide-y divide-border">
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
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {s.locationColor && (
                            <span
                              aria-hidden
                              className="h-2 w-2 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: s.locationColor }}
                            />
                          )}
                          <span>
                            {fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} ·{" "}
                            {s.role}
                          </span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {s.locationName ?? "—"}
                          {" · "}
                          {s.acceptedCount} accepted
                          {s.offeredCount > 0 ? ` · ${s.offeredCount} pending` : ""}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[s.status] ?? ""}`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="mt-2">
                      <Link
                        href={`/app/schedule/${s.id}/edit`}
                        className="text-xs text-primary hover:underline"
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
      <section className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
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
          <span className="hidden h-3 border-r border-border sm:block" />
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
  const dot =
    tone === "emerald"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : tone === "rose"
          ? "bg-rose-500"
          : tone === "blue"
            ? "bg-blue-500"
            : "bg-slate-400";
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </li>
  );
}
