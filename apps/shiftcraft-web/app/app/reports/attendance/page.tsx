import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scClockEvents,
  scEmployees,
  scShiftAssignments,
  scShifts,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";
import {
  deriveSegments,
  splitSegmentByDay,
} from "~/lib/clock";

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

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return "—";
  const pct = Math.round((num / denom) * 100);
  return `${pct}%`;
}

export default async function AttendanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (!isAtLeastManager(membership.role)) redirect("/app");
  const tenantId = membership.tenant.id;

  const { period: periodRaw } = await searchParams;
  const periodDays = parsePeriod(periodRaw);
  const periodEnd = startOfDay(new Date());
  const periodStart = addDays(periodEnd, -periodDays);

  // Step 1: every accepted shift assignment in the period (per-user list).
  const ctx = forTenant(tenantId);
  const shiftRows = await ctx.run((tx) =>
    tx
      .select({
        userId: scShiftAssignments.userId,
        shiftId: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
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
  );

  // Step 2: clock events in the period for those users (work-segments only).
  const userIds = Array.from(new Set(shiftRows.map((s) => s.userId)));
  const clockRows = userIds.length === 0
    ? []
    : await ctx.run((tx) =>
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
              lte(scClockEvents.occurredAt, addDays(periodEnd, 1)),
              inArray(scClockEvents.appUserId, userIds),
            ),
          ),
      );

  // Group clock events by user, derive work-segments, then split per day so
  // a shift starting on day N matches against work logged on day N.
  const workMsByUserDay = new Map<string, Map<string, number>>();
  const totalWorkMsByUser = new Map<string, number>();
  const eventsByUser = new Map<string, typeof clockRows>();
  for (const e of clockRows) {
    if (e.voidedAt) continue;
    const arr = eventsByUser.get(e.userId) ?? [];
    arr.push(e);
    eventsByUser.set(e.userId, arr);
  }
  for (const [uid, events] of eventsByUser) {
    // deriveSegments expects events sorted ASC by occurredAt; the DB query
    // didn't ORDER BY so do it here defensively.
    const sorted = [...events].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const segments = deriveSegments(
      sorted.map((s) => ({
        id: `${uid}-${s.occurredAt.toISOString()}`,
        appUserId: uid,
        eventType: s.eventType,
        occurredAt: s.occurredAt,
        locationId: null,
        voidedAt: null,
        source: "manual",
      })) as never,
    );
    const dayMap = workMsByUserDay.get(uid) ?? new Map<string, number>();
    let total = 0;
    for (const seg of segments) {
      if (seg.kind !== "work") continue;
      const parts = splitSegmentByDay(seg);
      for (const p of parts) {
        const dayKey = startOfDay(p.startedAt).toISOString().slice(0, 10);
        const ms = p.endedAt.getTime() - p.startedAt.getTime();
        dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + ms);
        total += ms;
      }
    }
    workMsByUserDay.set(uid, dayMap);
    totalWorkMsByUser.set(uid, total);
  }

  // Step 3: bucket scheduled shifts by user → days; intersect with worked
  // days to compute attended / no-show counts.
  const scheduledByUser = new Map<
    string,
    { scheduled: number; attended: number; noShows: number }
  >();
  for (const s of shiftRows) {
    const dayKey = startOfDay(s.startsAt).toISOString().slice(0, 10);
    const stats = scheduledByUser.get(s.userId) ?? {
      scheduled: 0,
      attended: 0,
      noShows: 0,
    };
    stats.scheduled += 1;
    const workedThatDay = workMsByUserDay.get(s.userId)?.get(dayKey);
    if (workedThatDay && workedThatDay > 0) {
      stats.attended += 1;
    } else {
      stats.noShows += 1;
    }
    scheduledByUser.set(s.userId, stats);
  }

  // Step 4: resolve names + employee link for display.
  const profileRows = userIds.length === 0
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
            inArray(appUsers.id, userIds),
          ),
        );
  const employeeLinks = userIds.length === 0
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
              inArray(scEmployees.appUserId, userIds),
            ),
          ),
      );
  const employeeIdByUserId = new Map<string, string>();
  for (const l of employeeLinks) {
    if (l.appUserId) employeeIdByUserId.set(l.appUserId, l.id);
  }
  const profileById = new Map(profileRows.map((p) => [p.id, p]));

  // Build sorted rows.
  const rows = userIds
    .map((uid) => {
      const p = profileById.get(uid);
      const stats = scheduledByUser.get(uid) ?? {
        scheduled: 0,
        attended: 0,
        noShows: 0,
      };
      return {
        userId: uid,
        employeeId: employeeIdByUserId.get(uid) ?? null,
        name: p?.name ?? p?.email ?? "Unknown",
        email: p?.email ?? "",
        image: p?.image ?? null,
        scheduled: stats.scheduled,
        attended: stats.attended,
        noShows: stats.noShows,
        totalWorkMs: totalWorkMsByUser.get(uid) ?? 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Aggregate footer.
  const totals = rows.reduce(
    (acc, r) => {
      acc.scheduled += r.scheduled;
      acc.attended += r.attended;
      acc.noShows += r.noShows;
      acc.workMs += r.totalWorkMs;
      return acc;
    },
    { scheduled: 0, attended: 0, noShows: 0, workMs: 0 },
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fmtDate(periodStart)} → {fmtDate(periodEnd)} · scheduled-vs-actual
            attendance per employee.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/reports">← Back to reports</Link>
        </Button>
      </div>

      {/* Period picker */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        <label htmlFor="period-picker" className="text-xs uppercase tracking-wider text-muted-foreground">
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
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
      </form>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Scheduled" value={String(totals.scheduled)} />
        <StatCard
          label="Attended"
          value={String(totals.attended)}
          tone={totals.attended > 0 ? "emerald" : "muted"}
        />
        <StatCard
          label="No-shows"
          value={String(totals.noShows)}
          tone={totals.noShows > 0 ? "rose" : "muted"}
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
                  <th className="px-4 py-2 font-medium">Scheduled</th>
                  <th className="px-4 py-2 font-medium">Attended</th>
                  <th className="px-4 py-2 font-medium">No-shows</th>
                  <th className="px-4 py-2 font-medium">Attendance %</th>
                  <th className="px-4 py-2 font-medium">Hours worked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const pctNum = r.scheduled === 0 ? 0 : r.attended / r.scheduled;
                  const pctTone =
                    r.scheduled === 0
                      ? "text-muted-foreground"
                      : pctNum >= 0.9
                        ? "text-emerald-600"
                        : pctNum >= 0.75
                          ? "text-amber-600"
                          : "text-rose-600";
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
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {r.scheduled}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {r.attended}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums">
                        {r.noShows > 0 ? (
                          <span className="font-semibold text-rose-600">
                            {r.noShows}
                          </span>
                        ) : (
                          r.noShows
                        )}
                      </td>
                      <td className={`px-4 py-2 font-mono tabular-nums font-semibold ${pctTone}`}>
                        {fmtPct(r.attended, r.scheduled)}
                      </td>
                      <td className="px-4 py-2 font-mono tabular-nums text-muted-foreground">
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
        "Attended" counts a scheduled shift as attended when the employee
        logged any work time on the same calendar day (clock-in stream,
        voided punches excluded). No-shows are scheduled shifts without
        same-day work. Late arrivals and partial shifts aren't surfaced in
        this slice.
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "muted" | "emerald" | "amber" | "rose";
}) {
  const cls =
    tone === "emerald"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "amber"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "rose"
          ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : tone === "muted"
            ? "border-border bg-card text-muted-foreground"
            : "border-border bg-card";
  return (
    <div className={`rounded-lg border px-4 py-3 ${cls}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider">{label}</div>
    </div>
  );
}
