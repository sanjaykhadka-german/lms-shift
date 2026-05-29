import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scClockEvents,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scTimesheetApprovals,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";
import {
  buildScoreboard,
  LATE_GRACE_MS,
  OT_GRACE_MS,
} from "~/lib/attendance-scoreboard";

export const metadata = { title: "Attendance · ShiftCraft" };
export const dynamic = "force-dynamic";

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
];

function parsePeriod(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "30", 10);
  if ([7, 30, 60, 90].includes(n)) return n;
  return 30;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtHoursMs(ms: number): string {
  if (ms <= 0) return "0h 0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function fmtMinutes(ms: number): string {
  if (ms <= 0) return "0m";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return "—";
  const pct = Math.round((num / denom) * 100);
  return `${pct}%`;
}

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; location?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const { period: periodRaw, location: locationRaw } = await searchParams;
  const periodDays = parsePeriod(periodRaw);
  const periodEnd = startOfDay(new Date());
  const periodStart = addDays(periodEnd, -periodDays);
  const locationFilter =
    locationRaw && locationRaw.trim() !== "" ? locationRaw : null;

  const ctx = forTenant(tenantId);

  // Pull accepted shifts in the period, plus the location list for the
  // filter dropdown.
  const [shiftRows, locationsList] = await Promise.all([
    ctx.run((tx) =>
      tx
        .select({
          userId: scShiftAssignments.userId,
          shiftId: scShifts.id,
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          locationId: scShifts.locationId,
        })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .where(
          and(
            eq(scShifts.traceyTenantId, tenantId),
            eq(scShiftAssignments.status, "accepted"),
            gte(scShifts.startsAt, periodStart),
            lte(scShifts.startsAt, periodEnd),
          ),
        ),
    ),
    ctx.run((tx) =>
      tx
        .select({ id: scLocations.id, name: scLocations.name })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId))
        .orderBy(asc(scLocations.name)),
    ),
  ]);

  const userIds = Array.from(new Set(shiftRows.map((s) => s.userId)));

  const [clockRows, approvalRows] = await Promise.all([
    userIds.length === 0
      ? Promise.resolve([])
      : ctx.run((tx) =>
          tx
            .select({
              userId: scClockEvents.appUserId,
              eventType: scClockEvents.eventType,
              occurredAt: scClockEvents.occurredAt,
              voidedAt: scClockEvents.voidedAt,
            })
            .from(scClockEvents)
            .where(
              and(
                eq(scClockEvents.traceyTenantId, tenantId),
                gte(scClockEvents.occurredAt, periodStart),
                // OT can spill past the shift end on the last scheduled
                // day, so widen the event window by a day.
                lte(scClockEvents.occurredAt, addDays(periodEnd, 1)),
                inArray(scClockEvents.appUserId, userIds),
              ),
            ),
        ),
    userIds.length === 0
      ? Promise.resolve([])
      : ctx.run((tx) =>
          tx
            .select({
              employeeUserId: scTimesheetApprovals.employeeUserId,
              weekStart: scTimesheetApprovals.weekStart,
              status: scTimesheetApprovals.status,
            })
            .from(scTimesheetApprovals)
            .where(
              and(
                eq(scTimesheetApprovals.traceyTenantId, tenantId),
                inArray(scTimesheetApprovals.employeeUserId, userIds),
              ),
            ),
        ),
  ]);

  // Build the "approved week" lookup. weekStart comes back as a string
  // (date column) in YYYY-MM-DD form — matches `weekKey` output.
  const approvedWeeks = new Set<string>();
  for (const a of approvalRows) {
    if (a.status === "approved") {
      approvedWeeks.add(`${a.employeeUserId}|${a.weekStart}`);
    }
  }

  const scores = buildScoreboard({
    shifts: shiftRows.map((s) => ({
      userId: s.userId,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      locationId: s.locationId,
    })),
    events: clockRows
      .filter((e) => !e.voidedAt)
      .map((e) => ({
        userId: e.userId,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
      })),
    approvedWeeks,
    locationId: locationFilter,
  });

  // Resolve names + employee link for display. Include every user the
  // scoreboard ended up surfacing (filtered or unfiltered).
  const surfaceUserIds = Array.from(scores.keys());
  const profileRows = surfaceUserIds.length === 0
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
            inArray(appUsers.id, surfaceUserIds),
          ),
        );
  const employeeLinks = surfaceUserIds.length === 0
    ? []
    : await ctx.run((tx) =>
        tx
          .select({
            id: scEmployees.id,
            appUserId: scEmployees.appUserId,
          })
          .from(scEmployees)
          .where(
            and(
              eq(scEmployees.traceyTenantId, tenantId),
              inArray(scEmployees.appUserId, surfaceUserIds),
            ),
          ),
      );
  const employeeIdByUserId = new Map<string, string>();
  for (const l of employeeLinks) {
    if (l.appUserId) employeeIdByUserId.set(l.appUserId, l.id);
  }
  const profileById = new Map(profileRows.map((p) => [p.id, p]));

  const rows = surfaceUserIds
    .map((uid) => {
      const p = profileById.get(uid);
      const s = scores.get(uid)!;
      return {
        userId: uid,
        employeeId: employeeIdByUserId.get(uid) ?? null,
        name: p?.name ?? p?.email ?? "Unknown",
        email: p?.email ?? "",
        image: p?.image ?? null,
        ...s,
      };
    })
    // Surface the worst attendance first so admins triage faster: highest
    // no-shows, then most late, then most unapproved OT, then by name.
    .sort(
      (a, b) =>
        b.noShows - a.noShows ||
        b.lateCount - a.lateCount ||
        b.unapprovedOtMs - a.unapprovedOtMs ||
        a.name.localeCompare(b.name),
    );

  const totals = rows.reduce(
    (acc, r) => {
      acc.scheduled += r.scheduled;
      acc.attended += r.attended;
      acc.noShows += r.noShows;
      acc.workMs += r.totalWorkMs;
      acc.lateCount += r.lateCount;
      acc.lateMs += r.lateMs;
      acc.unapprovedOtMs += r.unapprovedOtMs;
      return acc;
    },
    {
      scheduled: 0,
      attended: 0,
      noShows: 0,
      workMs: 0,
      lateCount: 0,
      lateMs: 0,
      unapprovedOtMs: 0,
    },
  );

  const periodParam = `period=${periodDays}`;
  const locationParam = locationFilter
    ? `&location=${encodeURIComponent(locationFilter)}`
    : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">
            Attendance
            <InfoPopover label="About the attendance report">
              <p>
                Per-employee counters for the selected period. Late =
                first clock-in past the shift&rsquo;s scheduled start by
                more than {Math.round(LATE_GRACE_MS / 60_000)} min. No-show =
                accepted shift with no clock activity that day. Unapproved
                OT = work logged past shift end (with{" "}
                {Math.round(OT_GRACE_MS / 60_000)}-min grace) during weeks
                without an approved timesheet.
              </p>
            </InfoPopover>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtDate(periodStart)} → {fmtDate(periodEnd)} ·
            scheduled-vs-actual attendance per employee.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/reports">← Back to reports</Link>
        </Button>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="period-picker"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Period
          </label>
          <select
            id="period-picker"
            name="period"
            defaultValue={String(periodDays)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {locationsList.length > 0 && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="location-picker"
              className="text-xs uppercase tracking-wider text-muted-foreground"
            >
              Location
            </label>
            <select
              id="location-picker"
              name="location"
              defaultValue={locationFilter ?? ""}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All locations</option>
              {locationsList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {locationFilter && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/app/reports/attendance?${periodParam}`}>
              Clear location
            </Link>
          </Button>
        )}
      </form>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Scheduled" value={String(totals.scheduled)} />
        <StatCard
          label="No-shows"
          value={String(totals.noShows)}
          tone={totals.noShows > 0 ? "rose" : "muted"}
        />
        <StatCard
          label="Late arrivals"
          value={String(totals.lateCount)}
          tone={totals.lateCount > 0 ? "amber" : "muted"}
          sub={
            totals.lateCount > 0
              ? `avg ${fmtMinutes(totals.lateMs / totals.lateCount)}`
              : undefined
          }
        />
        <StatCard
          label="Unapproved OT"
          value={fmtMinutes(totals.unapprovedOtMs)}
          tone={totals.unapprovedOtMs > 0 ? "amber" : "muted"}
        />
        <StatCard
          label="Attendance %"
          value={fmtPct(totals.attended, totals.scheduled)}
          tone={
            totals.scheduled === 0
              ? "muted"
              : totals.attended / totals.scheduled >= 0.9
                ? "emerald"
                : totals.attended / totals.scheduled >= 0.75
                  ? "amber"
                  : "rose"
          }
        />
      </div>

      {/* Per-employee table */}
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">
            By employee ({rows.length})
          </h2>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No accepted shifts in this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Scheduled</th>
                  <th className="px-3 py-2 font-medium">No-shows</th>
                  <th className="px-3 py-2 font-medium">Late</th>
                  <th className="px-3 py-2 font-medium">Unapproved OT</th>
                  <th className="px-3 py-2 font-medium">Attendance %</th>
                  <th className="px-3 py-2 font-medium">Hours worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const pctNum = r.scheduled === 0 ? 0 : r.attended / r.scheduled;
                  const pctTone =
                    r.scheduled === 0
                      ? "text-muted-foreground"
                      : pctNum >= 0.9
                        ? "text-[var(--live)]"
                        : pctNum >= 0.75
                          ? "text-[var(--warn)]"
                          : "text-[var(--danger)]";
                  return (
                    <tr key={r.userId}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={r.name}
                            email={r.email}
                            image={r.image}
                            sizeClass="h-8 w-8"
                            textClass="text-xs"
                          />
                          <div className="min-w-0">
                            {r.employeeId ? (
                              <Link
                                href={`/app/employees/${r.employeeId}/edit`}
                                className="text-sm font-medium hover:underline"
                              >
                                {r.name}
                              </Link>
                            ) : (
                              <span className="text-sm font-medium">
                                {r.name}
                              </span>
                            )}
                            <div className="truncate text-xs text-muted-foreground">
                              {r.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {r.scheduled}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {r.noShows > 0 ? (
                          <span className="font-semibold text-[var(--danger)]">
                            {r.noShows}
                          </span>
                        ) : (
                          r.noShows
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {r.lateCount > 0 ? (
                          <span>
                            <span className="font-semibold text-[var(--warn)]">
                              {r.lateCount}
                            </span>{" "}
                            <span className="text-xs text-muted-foreground">
                              (avg {fmtMinutes(r.lateMs / r.lateCount)})
                            </span>
                          </span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">
                        {r.unapprovedOtMs > 0 ? (
                          <span className="font-semibold text-[var(--warn)]">
                            {fmtMinutes(r.unapprovedOtMs)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0m</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 font-mono tabular-nums font-semibold ${pctTone}`}>
                        {fmtPct(r.attended, r.scheduled)}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                        {fmtHoursMs(r.totalWorkMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Attended = any clocked work time on the shift&rsquo;s calendar day
        (voided punches excluded). Late counts shifts where the first
        clock-in landed more than {Math.round(LATE_GRACE_MS / 60_000)}{" "}
        minutes after the scheduled start. Unapproved OT only counts inside
        weeks that don&rsquo;t yet have a timesheet approval. Approving a
        week in <Link href="/app/timesheets" className="underline">/app/timesheets</Link>{" "}
        removes its OT from this column.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "muted" | "emerald" | "amber" | "rose";
  sub?: string;
}) {
  const cls =
    tone === "emerald"
      ? "border-[color-mix(in_srgb,var(--live)_40%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)] text-[var(--live)]"
      : tone === "amber"
        ? "border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] text-[var(--warn)]"
        : tone === "rose"
          ? "border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]"
          : tone === "muted"
            ? "border-border bg-card text-muted-foreground"
            : "border-border bg-card";
  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] opacity-80">{sub}</div>}
    </div>
  );
}
