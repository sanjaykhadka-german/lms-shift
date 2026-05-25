import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployees,
  scLocations,
  users as appUsers,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import {
  addDays,
  deriveSegments,
  fmtHours,
  fmtIsoDate,
  getEventsInRangeForTenant,
  parseIsoDate,
  splitSegmentByDay,
  startOfWeek,
} from "~/lib/clock";

export const metadata = { title: "Reports · ShiftCraft" };

interface PersonRow {
  userId: string;
  name: string;
  email: string;
  thisWorkMs: number;
  prevWorkMs: number;
  hourlyRate: number | null;
}

function wageCostFor(workMs: number, rate: number | null): number {
  if (!rate || workMs <= 0) return 0;
  return (workMs / 3_600_000) * rate;
}

function fmtMoney(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "$0.00";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface LocationRow {
  locationId: string | null;
  locationName: string;
  thisWorkMs: number;
  prevWorkMs: number;
}

function deltaCell(thisMs: number, prevMs: number) {
  const diff = thisMs - prevMs;
  if (diff === 0) {
    return <span className="text-xs text-muted-foreground">±0</span>;
  }
  const sign = diff > 0 ? "+" : "−";
  const cls =
    diff > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-[color:var(--destructive)]";
  return (
    <span className={`text-xs font-medium tabular-nums ${cls}`}>
      {sign}
      {fmtHours(Math.abs(diff))}
    </span>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; department?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  if (membership.role !== "owner" && membership.role !== "admin") {
    redirect("/app");
  }
  const tenantId = membership.tenant.id;

  const { week, department: deptFilter } = await searchParams;
  const thisWeekStart = startOfWeek(parseIsoDate(week) ?? new Date());
  const thisWeekEnd = addDays(thisWeekStart, 7);
  const prevWeekStart = addDays(thisWeekStart, -7);
  const prevWeekEnd = thisWeekStart;
  const nextWeek = addDays(thisWeekStart, 7);
  const departmentFilter = deptFilter && deptFilter.trim() !== "" ? deptFilter : null;

  // Pull both weeks of events in two parallel queries — keeps the
  // aggregation simple and avoids one big range that complicates the
  // delta math.
  const [thisEvents, prevEvents, allMembers, allLocations, employeeRates] =
    await Promise.all([
      getEventsInRangeForTenant(tenantId, thisWeekStart, thisWeekEnd),
      getEventsInRangeForTenant(tenantId, prevWeekStart, prevWeekEnd),
      db
        .select({
          id: appUsers.id,
          name: appUsers.name,
          email: appUsers.email,
        })
        .from(appUsers)
        .innerJoin(members, eq(members.userId, appUsers.id))
        .where(eq(members.tenantId, tenantId))
        .orderBy(asc(appUsers.name), asc(appUsers.email)),
      forTenant(tenantId).run((tx) =>
        tx
          .select({
            id: scLocations.id,
            name: scLocations.name,
            color: scLocations.color,
          })
          .from(scLocations)
          .where(eq(scLocations.traceyTenantId, tenantId))
          .orderBy(asc(scLocations.name)),
      ),
      // Rates + department live on sc_employees, joined to sc_departments
      // for the friendly name. We pull all employee rows (not just
      // rate-bearing ones) so the department filter can resolve who's in
      // each department even when their rate isn't set yet.
      forTenant(tenantId).run((tx) =>
        tx
          .select({
            appUserId: scEmployees.appUserId,
            hourlyRate: scEmployees.hourlyRate,
            departmentId: scEmployees.departmentId,
            departmentName: scDepartments.name,
          })
          .from(scEmployees)
          .leftJoin(
            scDepartments,
            eq(scDepartments.id, scEmployees.departmentId),
          )
          .where(
            and(
              eq(scEmployees.traceyTenantId, tenantId),
              isNotNull(scEmployees.appUserId),
            ),
          ),
      ),
    ]);
  const rateByUser = new Map<string, number>();
  const deptByUser = new Map<string, string | null>();
  for (const r of employeeRates) {
    if (!r.appUserId) continue;
    if (r.hourlyRate) {
      const n = Number(r.hourlyRate);
      if (Number.isFinite(n)) rateByUser.set(r.appUserId, n);
    }
    deptByUser.set(r.appUserId, r.departmentName);
  }

  // Distinct department names to populate the filter dropdown.
  const allDepartments = await forTenant(tenantId).run((tx) =>
    tx
      .select({ name: scDepartments.name })
      .from(scDepartments)
      .where(eq(scDepartments.traceyTenantId, tenantId))
      .orderBy(asc(scDepartments.name)),
  );

  // If a department filter is active, narrow the user pool *before*
  // aggregating. Users without a department row are excluded — they
  // wouldn't match any filter anyway.
  const departmentMatch = (uid: string): boolean => {
    if (!departmentFilter) return true;
    const dept = deptByUser.get(uid);
    return dept != null && dept.toLowerCase() === departmentFilter.toLowerCase();
  };

  const memberById = new Map(
    allMembers.map((m) => [m.id, { name: m.name ?? m.email, email: m.email }]),
  );
  const locationNameById = new Map(allLocations.map((l) => [l.id, l.name]));

  // Aggregate per-user work ms for one week's worth of events.
  function aggregatePerUser(events: typeof thisEvents): Map<string, number> {
    const byUser = new Map<string, typeof events>();
    for (const e of events) {
      const arr = byUser.get(e.appUserId) ?? [];
      arr.push(e);
      byUser.set(e.appUserId, arr);
    }
    const out = new Map<string, number>();
    for (const [uid, evts] of byUser) {
      const segs = deriveSegments(evts, addDays(evts[0]!.occurredAt, 7));
      let work = 0;
      for (const s of segs) {
        if (s.kind !== "work") continue;
        work += s.endedAt.getTime() - s.startedAt.getTime();
      }
      out.set(uid, work);
    }
    return out;
  }

  // Aggregate per-location work ms. A work segment is attributed to the
  // location of the *most recent* 'in' or 'break_end' event at the time
  // the segment ran. We track that by replaying the stream.
  function aggregatePerLocation(events: typeof thisEvents): Map<string | null, number> {
    const out = new Map<string | null, number>();
    const byUser = new Map<string, typeof events>();
    for (const e of events) {
      const arr = byUser.get(e.appUserId) ?? [];
      arr.push(e);
      byUser.set(e.appUserId, arr);
    }
    for (const [, evts] of byUser) {
      let openAt: Date | null = null;
      let openKind: "work" | "break" | null = null;
      let currentLocation: string | null = null;
      const close = (at: Date) => {
        if (!openKind || !openAt) return;
        if (openKind === "work" && at > openAt) {
          const key = currentLocation;
          out.set(key, (out.get(key) ?? 0) + (at.getTime() - openAt.getTime()));
        }
        openKind = null;
        openAt = null;
      };
      for (const e of evts) {
        if (e.locationId != null) currentLocation = e.locationId;
        switch (e.eventType) {
          case "in":
            if (!openKind) {
              openKind = "work";
              openAt = e.occurredAt;
            }
            break;
          case "break_start":
            if (openKind === "work") {
              close(e.occurredAt);
              openKind = "break";
              openAt = e.occurredAt;
            }
            break;
          case "break_end":
            if (openKind === "break") {
              close(e.occurredAt);
              openKind = "work";
              openAt = e.occurredAt;
            }
            break;
          case "out":
            close(e.occurredAt);
            break;
        }
      }
      // Don't close open segments at week-end here — that would attribute
      // unbounded time to the last known location. Reports show closed
      // work only.
    }
    return out;
  }

  // If a department filter is active, drop events from non-matching users
  // before aggregation. Doing it once at the boundary keeps the per-user /
  // per-location helpers simple and consistent.
  const thisEventsFiltered = departmentFilter
    ? thisEvents.filter((e) => departmentMatch(e.appUserId))
    : thisEvents;
  const prevEventsFiltered = departmentFilter
    ? prevEvents.filter((e) => departmentMatch(e.appUserId))
    : prevEvents;

  const thisByUser = aggregatePerUser(thisEventsFiltered);
  const prevByUser = aggregatePerUser(prevEventsFiltered);
  const thisByLoc = aggregatePerLocation(thisEventsFiltered);
  const prevByLoc = aggregatePerLocation(prevEventsFiltered);

  // Build the people rows: every member with hours in either week, or
  // who's on the active member roster (so empty weeks still show).
  // When a department filter is active, also gate roster inclusion on
  // departmentMatch so people not in the chosen department drop out
  // entirely.
  const personIds = new Set<string>();
  for (const id of thisByUser.keys()) personIds.add(id);
  for (const id of prevByUser.keys()) personIds.add(id);
  for (const m of allMembers) {
    if (departmentFilter && !departmentMatch(m.id)) continue;
    personIds.add(m.id);
  }

  const peopleRows: PersonRow[] = Array.from(personIds).map((uid) => {
    const m = memberById.get(uid);
    return {
      userId: uid,
      name: m?.name ?? "Unknown",
      email: m?.email ?? "",
      thisWorkMs: thisByUser.get(uid) ?? 0,
      prevWorkMs: prevByUser.get(uid) ?? 0,
      hourlyRate: rateByUser.get(uid) ?? null,
    };
  });
  peopleRows.sort((a, b) => b.thisWorkMs - a.thisWorkMs || a.name.localeCompare(b.name));

  const totalWageCostThis = peopleRows.reduce(
    (s, r) => s + wageCostFor(r.thisWorkMs, r.hourlyRate),
    0,
  );
  const totalWageCostPrev = peopleRows.reduce(
    (s, r) => s + wageCostFor(r.prevWorkMs, r.hourlyRate),
    0,
  );
  const peopleWithoutRate = peopleRows.filter(
    (r) => r.thisWorkMs > 0 && r.hourlyRate == null,
  ).length;

  // AUDIT.md #9 — Hours by department rollup. Sum each user's hours
  // into their department bucket using the deptByUser map already
  // built above. "Unassigned" catches active people whose sc_employees
  // row has no department_id (e.g. casuals not yet sorted).
  interface DepartmentRow {
    departmentName: string;
    thisWorkMs: number;
    prevWorkMs: number;
    headcount: number;
  }
  const deptThis = new Map<string, { ms: number; ids: Set<string> }>();
  const deptPrev = new Map<string, number>();
  const deptKey = (uid: string) => deptByUser.get(uid) ?? "Unassigned";
  for (const [uid, ms] of thisByUser) {
    if (ms <= 0) continue;
    const k = deptKey(uid);
    const cell = deptThis.get(k) ?? { ms: 0, ids: new Set<string>() };
    cell.ms += ms;
    cell.ids.add(uid);
    deptThis.set(k, cell);
  }
  for (const [uid, ms] of prevByUser) {
    if (ms <= 0) continue;
    const k = deptKey(uid);
    deptPrev.set(k, (deptPrev.get(k) ?? 0) + ms);
  }
  const departmentKeys = new Set<string>([
    ...deptThis.keys(),
    ...deptPrev.keys(),
  ]);
  const departmentRows: DepartmentRow[] = Array.from(departmentKeys).map(
    (name) => ({
      departmentName: name,
      thisWorkMs: deptThis.get(name)?.ms ?? 0,
      prevWorkMs: deptPrev.get(name) ?? 0,
      headcount: deptThis.get(name)?.ids.size ?? 0,
    }),
  );
  departmentRows.sort((a, b) => b.thisWorkMs - a.thisWorkMs);

  // Location rows: include every location with hours in either week,
  // plus an "Unspecified" bucket for events with null locationId.
  const locIds = new Set<string | null>();
  for (const k of thisByLoc.keys()) locIds.add(k);
  for (const k of prevByLoc.keys()) locIds.add(k);
  const locationRows: LocationRow[] = Array.from(locIds).map((lid) => ({
    locationId: lid,
    locationName: lid ? locationNameById.get(lid) ?? "Unknown" : "Unspecified",
    thisWorkMs: thisByLoc.get(lid) ?? 0,
    prevWorkMs: prevByLoc.get(lid) ?? 0,
  }));
  locationRows.sort((a, b) => b.thisWorkMs - a.thisWorkMs);

  const totalThis = peopleRows.reduce((s, r) => s + r.thisWorkMs, 0);
  const totalPrev = peopleRows.reduce((s, r) => s + r.prevWorkMs, 0);
  const activeThis = peopleRows.filter((r) => r.thisWorkMs > 0).length;
  const activePrev = peopleRows.filter((r) => r.prevWorkMs > 0).length;

  const weekLabel = `${thisWeekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${addDays(thisWeekEnd, -1).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

  // Day-of-week mini distribution. Quick scan of which weekday the
  // tenant works most.
  const dayWork = Array.from({ length: 7 }, () => 0);
  for (const ev of thisEvents) {
    // Skip — actual hours come from segments, not events directly.
  }
  // Build via segments for correctness:
  for (const m of allMembers) {
    const events = thisEvents.filter((e) => e.appUserId === m.id);
    if (events.length === 0) continue;
    const segs = deriveSegments(events, thisWeekEnd);
    for (const seg of segs) {
      if (seg.kind !== "work") continue;
      for (const chunk of splitSegmentByDay(seg)) {
        const dayIdx = Math.floor(
          (chunk.startedAt.getTime() - thisWeekStart.getTime()) / 86_400_000,
        );
        if (dayIdx >= 0 && dayIdx < 7) {
          dayWork[dayIdx]! += chunk.endedAt.getTime() - chunk.startedAt.getTime();
        }
      }
    }
  }
  const maxDay = Math.max(1, ...dayWork);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hours worked across {membership.tenant.name} this week, with
            week-over-week deltas. Derived from clock-event activity.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">More reports:</span>
            <Link
              href="/app/reports/birthdays-anniversaries"
              className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              🎂 Birthdays & anniversaries
            </Link>
            <Link
              href="/app/reports/attendance"
              className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              📋 Attendance
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={
                "/app/reports?week=" +
                fmtIsoDate(addDays(thisWeekStart, -7)) +
                (departmentFilter ? `&department=${encodeURIComponent(departmentFilter)}` : "")
              }
            >
              ← Previous
            </Link>
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
            {weekLabel}
          </span>
          <Button asChild variant="outline" size="sm">
            <Link
              href={
                "/app/reports?week=" +
                fmtIsoDate(nextWeek) +
                (departmentFilter ? `&department=${encodeURIComponent(departmentFilter)}` : "")
              }
            >
              Next →
            </Link>
          </Button>
          <Button asChild size="sm">
            <a
              href={
                "/api/reports/export?week=" +
                fmtIsoDate(thisWeekStart) +
                (departmentFilter ? `&department=${encodeURIComponent(departmentFilter)}` : "")
              }
            >
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      {allDepartments.length > 0 && (
        <form
          action="/app/reports"
          method="get"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <input
            type="hidden"
            name="week"
            value={fmtIsoDate(thisWeekStart)}
          />
          <label
            htmlFor="department-filter"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Department:
          </label>
          <select
            id="department-filter"
            name="department"
            defaultValue={departmentFilter ?? ""}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="">All departments</option>
            {allDepartments.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
          {departmentFilter && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/app/reports?week=${fmtIsoDate(thisWeekStart)}`}>
                Clear
              </Link>
            </Button>
          )}
        </form>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total hours" value={fmtHours(totalThis)} delta={totalThis - totalPrev} />
        <Kpi
          label="Active people"
          value={`${activeThis}`}
          delta={activeThis - activePrev}
          isCount
        />
        <Kpi
          label="Avg / active person"
          value={fmtHours(activeThis > 0 ? Math.round(totalThis / activeThis) : 0)}
          delta={
            (activeThis > 0 ? Math.round(totalThis / activeThis) : 0) -
            (activePrev > 0 ? Math.round(totalPrev / activePrev) : 0)
          }
        />
        <WageKpi
          value={fmtMoney(totalWageCostThis)}
          deltaAmount={totalWageCostThis - totalWageCostPrev}
          missingCount={peopleWithoutRate}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Hours by day of week</h2>
          <span className="text-xs text-muted-foreground">
            Mon → Sun · this week
          </span>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-end gap-2">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
              const h = dayWork[i] ?? 0;
              const heightPct = (h / maxDay) * 100;
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-md bg-primary/30"
                    style={{ height: `${Math.max(2, heightPct)}px` }}
                    title={fmtHours(h)}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {d}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {fmtHours(h)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Hours by employee</h2>
          <span className="text-xs text-muted-foreground">
            {peopleRows.filter((r) => r.thisWorkMs > 0 || r.prevWorkMs > 0).length}{" "}
            with activity
          </span>
        </div>
        {peopleRows.every((r) => r.thisWorkMs === 0 && r.prevWorkMs === 0) ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No clock activity recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Hours</th>
                  <th className="px-3 py-2 font-medium">vs last week</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                  <th className="px-3 py-2 font-medium">Wage cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {peopleRows
                  .filter((r) => r.thisWorkMs > 0 || r.prevWorkMs > 0)
                  .map((r) => {
                    const wage = wageCostFor(r.thisWorkMs, r.hourlyRate);
                    return (
                      <tr key={r.userId}>
                        <td className="px-4 py-2">
                          <div className="text-sm font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.email}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-sm font-semibold tabular-nums">
                          {fmtHours(r.thisWorkMs)}
                        </td>
                        <td className="px-3 py-2">
                          {deltaCell(r.thisWorkMs, r.prevWorkMs)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                          {r.hourlyRate == null
                            ? "—"
                            : `$${r.hourlyRate.toFixed(2)}/h`}
                        </td>
                        <td className="px-3 py-2 font-mono text-sm tabular-nums">
                          {r.hourlyRate == null ? (
                            <span className="text-xs text-muted-foreground">
                              not set
                            </span>
                          ) : (
                            fmtMoney(wage)
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Hours by department</h2>
          <span className="text-xs text-muted-foreground">
            Grouped by each employee&rsquo;s assigned department
          </span>
        </div>
        {departmentRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No clock activity recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-3 py-2 font-medium">People</th>
                  <th className="px-3 py-2 font-medium">Hours</th>
                  <th className="px-3 py-2 font-medium">vs last week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {departmentRows.map((r) => (
                  <tr key={r.departmentName}>
                    <td className="px-4 py-2">
                      <div className="text-sm font-medium">
                        {r.departmentName}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                      {r.headcount}
                    </td>
                    <td className="px-3 py-2 font-mono text-sm font-semibold tabular-nums">
                      {fmtHours(r.thisWorkMs)}
                    </td>
                    <td className="px-3 py-2">
                      {deltaCell(r.thisWorkMs, r.prevWorkMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Hours by location</h2>
          <span className="text-xs text-muted-foreground">
            Attributed to the last punched-in location at the time the work
            happened.
          </span>
        </div>
        {locationRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No location-tagged clock activity yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Hours</th>
                  <th className="px-3 py-2 font-medium">vs last week</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {locationRows.map((r) => (
                  <tr key={r.locationId ?? "_unspec"}>
                    <td className="px-4 py-2">
                      <div className="text-sm font-medium">{r.locationName}</div>
                    </td>
                    <td className="px-3 py-2 font-mono text-sm font-semibold tabular-nums">
                      {fmtHours(r.thisWorkMs)}
                    </td>
                    <td className="px-3 py-2">
                      {deltaCell(r.thisWorkMs, r.prevWorkMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-[11px] text-muted-foreground">
        Wage cost uses each employee's <code>hourly_rate</code> on{" "}
        <Link href="/app/employees" className="underline">
          /app/employees
        </Link>
        . Rows without a rate are excluded from the total — set rates on the
        employee edit page to bring them in.
      </p>
    </div>
  );
}

function WageKpi({
  value,
  deltaAmount,
  missingCount,
}: {
  value: string;
  deltaAmount: number;
  missingCount: number;
}) {
  const positive = deltaAmount > 0;
  const negative = deltaAmount < 0;
  const cls = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : negative
      ? "text-[color:var(--destructive)]"
      : "text-muted-foreground";
  const sign = deltaAmount === 0 ? "±" : deltaAmount > 0 ? "+" : "−";
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        Wage cost
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className={`mt-1 text-xs font-medium ${cls}`}>
        {sign}
        {fmtMoney(Math.abs(deltaAmount))} vs last week
      </div>
      {missingCount > 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {missingCount} {missingCount === 1 ? "person" : "people"} excluded
          (no rate set)
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  isCount,
}: {
  label: string;
  value: string;
  delta: number;
  isCount?: boolean;
}) {
  const positive = delta > 0;
  const negative = delta < 0;
  const deltaLabel = isCount
    ? `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta)}`
    : delta === 0
      ? "±0"
      : `${delta > 0 ? "+" : "−"}${fmtHours(Math.abs(delta))}`;
  const cls = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : negative
      ? "text-[color:var(--destructive)]"
      : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      <div className={`mt-1 text-xs font-medium ${cls}`}>
        {deltaLabel} vs last week
      </div>
    </div>
  );
}
