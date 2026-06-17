import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scDepartments,
  scEmployees,
  users as appUsers,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import {
  addDays,
  deriveSegments,
  fmtIsoDate,
  getEventsInRangeForTenant,
  parseIsoDate,
  startOfWeek,
} from "~/lib/clock";

// AUDIT.md #9 — CSV export of /app/reports. One row per member with
// activity in this week OR last week, with department + rate + wage
// cost so payroll can reconcile. Mirrors the timesheets export
// authentication pattern (admin-only — non-admins get 401).

function csvCell(v: string | null | undefined): string {
  const s = v ?? "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtMsAsDecimalHours(ms: number): string {
  if (ms <= 0) return "0.00";
  return (ms / 3_600_000).toFixed(2);
}

function fmtMoney(amount: number): string {
  return amount.toFixed(2);
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const membership = await currentMembership();
  if (!membership) {
    return NextResponse.json({ error: "No workspace" }, { status: 401 });
  }
  const isAdmin = isAtLeastManager(membership.role);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = membership.tenant.id;

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const deptParam = url.searchParams.get("department");
  const departmentFilter =
    deptParam && deptParam.trim() !== "" ? deptParam : null;
  const thisWeekStart = startOfWeek(parseIsoDate(weekParam) ?? new Date());
  const thisWeekEnd = addDays(thisWeekStart, 7);
  const prevWeekStart = addDays(thisWeekStart, -7);
  const prevWeekEnd = thisWeekStart;

  // Mirror /app/reports' parallel fetches so the CSV is consistent
  // with what the page shows.
  const [thisEvents, prevEvents, allMembers, employeeJoin] = await Promise.all([
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
          appUserId: scEmployees.appUserId,
          hourlyRate: scEmployees.hourlyRate,
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
  for (const r of employeeJoin) {
    if (!r.appUserId) continue;
    if (r.hourlyRate) {
      const n = Number(r.hourlyRate);
      if (Number.isFinite(n)) rateByUser.set(r.appUserId, n);
    }
    deptByUser.set(r.appUserId, r.departmentName);
  }
  const memberById = new Map(
    allMembers.map((m) => [m.id, { name: m.name ?? m.email, email: m.email }]),
  );

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

  const departmentMatch = (uid: string): boolean => {
    if (!departmentFilter) return true;
    const dept = deptByUser.get(uid);
    return dept != null && dept.toLowerCase() === departmentFilter.toLowerCase();
  };

  const thisFiltered = departmentFilter
    ? thisEvents.filter((e) => departmentMatch(e.appUserId))
    : thisEvents;
  const prevFiltered = departmentFilter
    ? prevEvents.filter((e) => departmentMatch(e.appUserId))
    : prevEvents;
  const thisByUser = aggregatePerUser(thisFiltered);
  const prevByUser = aggregatePerUser(prevFiltered);

  // Roster: members with activity in either week, OR active members
  // matching the optional department filter.
  const personIds = new Set<string>();
  for (const id of thisByUser.keys()) personIds.add(id);
  for (const id of prevByUser.keys()) personIds.add(id);
  for (const m of allMembers) {
    if (departmentFilter && !departmentMatch(m.id)) continue;
    personIds.add(m.id);
  }

  const header = [
    "Employee",
    "Email",
    "Department",
    "Hours this week",
    "Hours last week",
    "Delta",
    "Hourly rate (AUD)",
    "Wage cost (AUD)",
  ];
  const lines: string[] = [header.join(",")];

  // Stable sort: highest activity first, then alphabetic.
  const sortedIds = Array.from(personIds).sort((a, b) => {
    const aHours = thisByUser.get(a) ?? 0;
    const bHours = thisByUser.get(b) ?? 0;
    if (bHours !== aHours) return bHours - aHours;
    const ma = memberById.get(a);
    const mb = memberById.get(b);
    return (ma?.name ?? "").localeCompare(mb?.name ?? "");
  });

  for (const uid of sortedIds) {
    const m = memberById.get(uid);
    if (!m) continue;
    const thisMs = thisByUser.get(uid) ?? 0;
    const prevMs = prevByUser.get(uid) ?? 0;
    // Skip empty roster rows (no hours either week) to keep the CSV
    // focused; the page shows these too but a CSV with 100 zero rows
    // is just noise.
    if (thisMs === 0 && prevMs === 0) continue;
    const rate = rateByUser.get(uid) ?? null;
    const wageCost = rate != null ? (thisMs / 3_600_000) * rate : null;
    const delta = thisMs - prevMs;
    lines.push(
      [
        csvCell(m.name),
        csvCell(m.email),
        csvCell(deptByUser.get(uid) ?? ""),
        fmtMsAsDecimalHours(thisMs),
        fmtMsAsDecimalHours(prevMs),
        (delta >= 0 ? "+" : "-") + fmtMsAsDecimalHours(Math.abs(delta)),
        rate != null ? rate.toFixed(2) : "",
        wageCost != null ? fmtMoney(wageCost) : "",
      ].join(","),
    );
  }

  const body = lines.join("\r\n") + "\r\n";
  const suffix = departmentFilter ? `-${departmentFilter}` : "";
  const filename = `reports-${fmtIsoDate(thisWeekStart)}${suffix}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
