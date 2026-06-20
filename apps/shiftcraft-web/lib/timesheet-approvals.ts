import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  members,
  scClockEvents,
  scTimesheetApprovals,
  users,
} from "@tracey/db";
import { fmtIsoDate, startOfWeek } from "~/lib/clock";
import { notifyTenantAdmins } from "~/lib/notifications";
import { sendTimesheetApprovalSummary } from "~/lib/email";

// R1 Features 3+4 — the timesheet approval digest (weekly summary + stale
// nudge, merged). Scans the trailing N completed weeks, works out which still
// have worked-but-unapproved timesheets, flags weeks pending longer than
// `staleDays` as overdue, and notifies tenant admins in-app + by email.
//
// "Pending" mirrors the grid: a worker who clocked activity that week but has
// no approved/disputed approval row. We derive it from clock events (not the
// heavy per-day aggregation the grid does) so the digest stays cheap.

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export interface ApprovalDigestResult {
  totalPending: number;
  staleCount: number;
  weeksReported: number;
}

export async function runApprovalDigest(
  tenantId: string,
  tenantName: string,
  opts: { staleDays?: number; weeksBack?: number; now?: Date } = {},
): Promise<ApprovalDigestResult> {
  const staleDays = opts.staleDays ?? 7;
  const weeksBack = Math.max(1, Math.min(12, opts.weeksBack ?? 4));
  const now = opts.now ?? new Date();
  const thisMonday = startOfWeek(now);

  interface WeekRow {
    weekStart: Date;
    pending: number;
    approved: number;
    disputed: number;
    stale: boolean;
  }
  const weekRows: WeekRow[] = [];

  for (let i = 1; i <= weeksBack; i++) {
    const weekStart = addDays(thisMonday, -7 * i);
    const weekEnd = addDays(weekStart, 7); // exclusive
    const weekIso = fmtIsoDate(weekStart);

    // Distinct workers with non-voided clock activity that week. ISO +
    // ::timestamptz casts per the postgres-js type-hint convention.
    const workerRows = await forTenant(tenantId).run((tx) =>
      tx
        .selectDistinct({ uid: scClockEvents.appUserId })
        .from(scClockEvents)
        .where(
          and(
            eq(scClockEvents.traceyTenantId, tenantId),
            isNull(scClockEvents.voidedAt),
            sql`${scClockEvents.occurredAt} >= ${weekStart.toISOString()}::timestamptz`,
            sql`${scClockEvents.occurredAt} < ${weekEnd.toISOString()}::timestamptz`,
          ),
        ),
    );
    const workers = new Set(workerRows.map((r) => r.uid));
    if (workers.size === 0) continue;

    const approvals = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          userId: scTimesheetApprovals.employeeUserId,
          status: scTimesheetApprovals.status,
        })
        .from(scTimesheetApprovals)
        .where(
          and(
            eq(scTimesheetApprovals.traceyTenantId, tenantId),
            sql`${scTimesheetApprovals.weekStart} = ${weekIso}::date`,
          ),
        ),
    );
    const decided = new Set<string>();
    let approved = 0;
    let disputed = 0;
    for (const a of approvals) {
      if (a.status === "approved") {
        approved += 1;
        decided.add(a.userId);
      } else if (a.status === "disputed") {
        disputed += 1;
        decided.add(a.userId);
      }
    }
    const pending = [...workers].filter((u) => !decided.has(u)).length;
    if (pending === 0) continue;
    const stale = weekEnd.getTime() < now.getTime() - staleDays * 86_400_000;
    weekRows.push({ weekStart, pending, approved, disputed, stale });
  }

  const totalPending = weekRows.reduce((s, w) => s + w.pending, 0);
  const staleCount = weekRows.filter((w) => w.stale).length;
  if (totalPending === 0) {
    return { totalPending: 0, staleCount: 0, weeksReported: 0 };
  }

  // One line per week (newest first — the loop already runs i=1..N back).
  const lines = weekRows.map((w) => {
    const label = w.weekStart.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
    const bits = [`${w.pending} pending`];
    if (w.approved) bits.push(`${w.approved} approved`);
    if (w.disputed) bits.push(`${w.disputed} disputed`);
    return `Week of ${label}: ${bits.join(", ")}${
      w.stale ? `  ⚠ overdue (>${staleDays} days)` : ""
    }`;
  });
  const summary = lines.join("\n");

  // In-app bell for every admin/owner.
  await notifyTenantAdmins(tenantId, {
    kind: "shiftcraft.timesheet.approval_digest",
    title: `${totalPending} timesheet${totalPending === 1 ? "" : "s"} awaiting approval`,
    body: lines.join(" · "),
    actionUrl: "/app/timesheets",
  });

  // Email every admin/owner (same role set as notifyTenantAdmins; queried
  // here for their addresses — mirrors documents-expiring/actions.ts).
  const adminRecipients = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .innerJoin(members, eq(members.userId, users.id))
    .where(
      and(
        eq(members.tenantId, tenantId),
        inArray(members.role, ["owner", "admin"]),
      ),
    );
  const to = adminRecipients
    .filter((m) => m.email && m.email.length > 0)
    .map((m) => ({ email: m.email!, name: m.name }));
  if (to.length > 0) {
    await sendTimesheetApprovalSummary({
      to,
      tenantName,
      total: totalPending,
      summary,
    });
  }

  return { totalPending, staleCount, weeksReported: weekRows.length };
}
