import { NextResponse, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scTimesheetApprovals,
  users,
  type ScTimesheetApprovalStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import {
  addDays,
  deriveSegments,
  fmtIsoDate,
  getEventsInRangeForTenant,
  getEventsInRangeForUser,
  parseIsoDate,
  splitSegmentByDay,
  startOfWeek,
} from "~/lib/clock";

function csvCell(v: string | null | undefined): string {
  let s = v ?? "";
  // Neutralize CSV formula injection: a leading = + - @ (or tab/CR) makes
  // Excel/Sheets execute the cell as a formula. Prefix with a single quote.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtMsAsDecimalHours(ms: number): string {
  if (ms <= 0) return "0.00";
  return (ms / 3_600_000).toFixed(2);
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
  const tenantId = membership.tenant.id;

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const weekStart = startOfWeek(parseIsoDate(weekParam) ?? new Date());
  // 1 WK / 2 WK — the export covers the same window shown on screen.
  const windowDays = url.searchParams.get("range") === "2w" ? 14 : 7;
  const weekEnd = addDays(weekStart, windowDays);

  // Whose timesheet rows to include.
  const memberRows = isAdmin
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

  const allEvents = isAdmin
    ? await getEventsInRangeForTenant(tenantId, weekStart, weekEnd)
    : await getEventsInRangeForUser(tenantId, user.id, weekStart, weekEnd);

  const byUser = new Map<string, typeof allEvents>();
  for (const e of allEvents) {
    const arr = byUser.get(e.appUserId) ?? [];
    arr.push(e);
    byUser.set(e.appUserId, arr);
  }

  // Approval status, keyed by "employeeUserId|weekStartIso". In 2 WK mode the
  // window spans two weeks, each with its own approval row, so we look up per
  // (employee, owning week). One small query per week start (max 2).
  const weekStartIsos = Array.from({ length: windowDays / 7 }, (_, i) =>
    fmtIsoDate(addDays(weekStart, i * 7)),
  );
  const approvalByUserWeek = new Map<string, ScTimesheetApprovalStatus>();
  for (const wkIso of weekStartIsos) {
    const approvalRows = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          employeeUserId: scTimesheetApprovals.employeeUserId,
          status: scTimesheetApprovals.status,
        })
        .from(scTimesheetApprovals)
        .where(
          and(
            eq(scTimesheetApprovals.traceyTenantId, tenantId),
            sql`${scTimesheetApprovals.weekStart} = ${wkIso}::date`,
          ),
        ),
    );
    for (const r of approvalRows) {
      approvalByUserWeek.set(
        `${r.employeeUserId}|${wkIso}`,
        r.status as ScTimesheetApprovalStatus,
      );
    }
  }

  // CSV: one row per (user, day) with non-zero hours. Header below.
  const header = [
    "Employee",
    "Email",
    "Date",
    "Work hours (decimal)",
    "Break hours (decimal)",
    "Approval status",
  ];
  const lines: string[] = [header.join(",")];
  for (const m of memberRows) {
    const userEvents = byUser.get(m.userId) ?? [];
    const segments = deriveSegments(userEvents, weekEnd);
    const perDayWork = new Map<string, number>();
    const perDayBreak = new Map<string, number>();
    for (const seg of segments) {
      for (const chunk of splitSegmentByDay(seg)) {
        const dayKey = fmtIsoDate(chunk.startedAt);
        const ms = chunk.endedAt.getTime() - chunk.startedAt.getTime();
        if (seg.kind === "work") {
          perDayWork.set(dayKey, (perDayWork.get(dayKey) ?? 0) + ms);
        } else {
          perDayBreak.set(dayKey, (perDayBreak.get(dayKey) ?? 0) + ms);
        }
      }
    }
    // Emit one line per day in the week (even zero-hour days) for admin
    // export; for self-export, skip empty days to keep the file short.
    for (let i = 0; i < windowDays; i++) {
      const day = addDays(weekStart, i);
      const key = fmtIsoDate(day);
      const w = perDayWork.get(key) ?? 0;
      const b = perDayBreak.get(key) ?? 0;
      if (!isAdmin && w === 0 && b === 0) continue;
      const wkIso = weekStartIsos[Math.floor(i / 7)]!;
      const approval = approvalByUserWeek.get(`${m.userId}|${wkIso}`);
      const statusLabel = approval
        ? approval === "approved"
          ? "Approved"
          : "Disputed"
        : w > 0 || b > 0
          ? "Pending"
          : "";
      lines.push(
        [
          csvCell(m.name ?? m.email),
          csvCell(m.email),
          csvCell(key),
          fmtMsAsDecimalHours(w),
          fmtMsAsDecimalHours(b),
          csvCell(statusLabel),
        ].join(","),
      );
    }
  }

  const body = lines.join("\r\n") + "\r\n";
  const filename = `timesheets-${fmtIsoDate(weekStart)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
