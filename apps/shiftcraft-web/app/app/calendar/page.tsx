import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scLeaveTypes,
  scShiftAssignments,
  scShifts,
  scTimeOffRequests,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { getHolidaysForTenant } from "~/lib/holidays";
import { Button } from "~/components/ui/button";
import { InfoPopover } from "~/components/InfoPopover";

export const metadata = { title: "Calendar · ShiftCraft" };
export const dynamic = "force-dynamic";

// ─── Date helpers (local-tz, Monday-start week) ─────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseMonth(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    return new Date(y!, m! - 1, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function startOfGrid(monthStart: Date): Date {
  // Render the Monday on or before the 1st so the grid aligns to a
  // 7-column Mon..Sun layout.
  const d = new Date(monthStart);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}
function shiftMonth(monthStart: Date, delta: number): Date {
  return new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1);
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

const LEAVE_BADGE: Record<string, string> = {
  annual: "bg-sky-600",
  personal_sick: "bg-rose-600",
  unpaid: "bg-slate-600",
  long_service: "bg-violet-600",
  other: "bg-amber-600",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; employee?: string }>;
}) {
  const membership = await currentMembership();
  if (!membership) redirect("/app");
  const user = await requireUser();
  const tenantId = membership.tenant.id;
  const isAdmin = isAtLeastManager(membership.role);

  const { month: rawMonth, employee: rawEmployee } = await searchParams;
  const monthStart = parseMonth(rawMonth);
  const monthEnd = shiftMonth(monthStart, 1);
  const gridStart = startOfGrid(monthStart);
  // 6 weeks × 7 days = 42 cells covers every month layout.
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);
  const gridStartIso = isoDate(gridStart);
  const gridEndIso = isoDate(new Date(gridEnd.getTime() - 1));

  // ─── Target employee resolution ───
  //
  // Admins can pick any employee via ?employee=<id>. Workers always
  // see their own row (rawEmployee ignored).

  let targetEmployeeId: string | null = null;
  let targetEmployeeName: string | null = null;
  if (isAdmin && rawEmployee) {
    const [match] = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id, fullName: scEmployees.fullName })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.id, rawEmployee),
            eq(scEmployees.traceyTenantId, tenantId),
          ),
        )
        .limit(1),
    );
    if (match) {
      targetEmployeeId = match.id;
      targetEmployeeName = match.fullName;
    }
  }
  if (!targetEmployeeId) {
    const [self] = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id, fullName: scEmployees.fullName })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            eq(scEmployees.appUserId, user.id),
          ),
        )
        .limit(1),
    );
    if (self) {
      targetEmployeeId = self.id;
      targetEmployeeName = self.fullName;
    }
  }

  // Resolve target's appUserId for the time-off + shifts queries.
  let targetAppUserId: string | null = null;
  if (targetEmployeeId) {
    const [row] = await forTenant(tenantId).run((tx) =>
      tx
        .select({ appUserId: scEmployees.appUserId })
        .from(scEmployees)
        .where(eq(scEmployees.id, targetEmployeeId))
        .limit(1),
    );
    targetAppUserId = row?.appUserId ?? null;
  }

  // Admin employee picker list — names only.
  const allEmployees = isAdmin
    ? await forTenant(tenantId).run((tx) =>
        tx
          .select({ id: scEmployees.id, fullName: scEmployees.fullName })
          .from(scEmployees)
          .where(
            and(
              eq(scEmployees.traceyTenantId, tenantId),
              eq(scEmployees.isActive, true),
            ),
          )
          .orderBy(asc(scEmployees.fullName)),
      )
    : [];

  // ─── Data fetches (parallel) ───

  const [leaveRows, leaveTypes, shifts, holidays] = await Promise.all([
    targetAppUserId
      ? forTenant(tenantId).run((tx) =>
          tx
            .select({
              startDate: scTimeOffRequests.startDate,
              endDate: scTimeOffRequests.endDate,
              status: scTimeOffRequests.status,
              leaveTypeId: scTimeOffRequests.leaveTypeId,
            })
            .from(scTimeOffRequests)
            .where(
              and(
                eq(scTimeOffRequests.traceyTenantId, tenantId),
                eq(scTimeOffRequests.userId, targetAppUserId),
                or(
                  eq(scTimeOffRequests.status, "approved"),
                  eq(scTimeOffRequests.status, "pending"),
                ),
                lte(scTimeOffRequests.startDate, gridEndIso),
                gte(scTimeOffRequests.endDate, gridStartIso),
              ),
            ),
        )
      : Promise.resolve([]),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scLeaveTypes.id,
          slug: scLeaveTypes.slug,
          name: scLeaveTypes.name,
        })
        .from(scLeaveTypes)
        .where(eq(scLeaveTypes.traceyTenantId, tenantId)),
    ),
    targetAppUserId
      ? forTenant(tenantId).run((tx) =>
          tx
            .select({
              startsAt: scShifts.startsAt,
              endsAt: scShifts.endsAt,
              role: scShifts.role,
              status: scShiftAssignments.status,
            })
            .from(scShiftAssignments)
            .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
            .where(
              and(
                eq(scShifts.traceyTenantId, tenantId),
                eq(scShiftAssignments.userId, targetAppUserId),
                eq(scShiftAssignments.status, "accepted"),
                sql`${scShifts.startsAt} >= ${gridStart.toISOString()}::timestamptz`,
                sql`${scShifts.startsAt} < ${gridEnd.toISOString()}::timestamptz`,
              ),
            ),
        )
      : Promise.resolve([]),
    getHolidaysForTenant(tenantId, gridStartIso, gridEndIso),
  ]);

  const typeBySlug = new Map(leaveTypes.map((t) => [t.id, t.slug]));
  const typeNameById = new Map(leaveTypes.map((t) => [t.id, t.name]));

  // ─── Build day → annotations map ───

  interface DayAnnotation {
    leavePending?: { slug: string; name: string };
    leaveApproved?: { slug: string; name: string };
    shiftCount?: number;
    holiday?: { name: string; region: string | null };
  }
  const byDay = new Map<string, DayAnnotation>();
  const ensure = (iso: string): DayAnnotation => {
    let cell = byDay.get(iso);
    if (!cell) {
      cell = {};
      byDay.set(iso, cell);
    }
    return cell;
  };

  for (const l of leaveRows) {
    if (!l.leaveTypeId) continue;
    const slug = typeBySlug.get(l.leaveTypeId) ?? "other";
    const name = typeNameById.get(l.leaveTypeId) ?? "Leave";
    const start = new Date(`${l.startDate}T00:00:00`);
    const end = new Date(`${l.endDate}T00:00:00`);
    for (
      let d = new Date(start);
      d <= end;
      d.setDate(d.getDate() + 1)
    ) {
      const cell = ensure(isoDate(d));
      if (l.status === "approved") cell.leaveApproved = { slug, name };
      else if (l.status === "pending" && !cell.leaveApproved)
        cell.leavePending = { slug, name };
    }
  }

  for (const s of shifts) {
    const iso = isoDate(s.startsAt);
    const cell = ensure(iso);
    cell.shiftCount = (cell.shiftCount ?? 0) + 1;
  }

  for (const h of holidays) {
    ensure(h.date).holiday = { name: h.name, region: h.isNational ? null : h.region };
  }

  // ─── Render grid ───

  const days: Array<{ iso: string; date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    days.push({
      iso: isoDate(d),
      date: d,
      inMonth: d.getMonth() === monthStart.getMonth(),
    });
  }

  const prevParam = `${shiftMonth(monthStart, -1).getFullYear()}-${pad(shiftMonth(monthStart, -1).getMonth() + 1)}`;
  const nextParam = `${shiftMonth(monthStart, 1).getFullYear()}-${pad(shiftMonth(monthStart, 1).getMonth() + 1)}`;
  const empQuery = targetEmployeeId && isAdmin ? `&employee=${targetEmployeeId}` : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            Calendar
            <InfoPopover label="About the calendar">
              <p>
                Combined month view: approved leave, pending requests,
                accepted shifts, and AU public holidays for your
                tenant region.
              </p>
              <p className="mt-1">
                Approved leave blocks the auto-scheduler; pending leave
                is informational. Public holidays attract penalty rates
                on the timesheet classifier.
              </p>
            </InfoPopover>
          </h1>
          {targetEmployeeName && (
            <p className="mt-1 text-sm text-muted-foreground">
              Viewing <strong>{targetEmployeeName}</strong>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/app/calendar?month=${prevParam}${empQuery}`}>
              ← Previous
            </Link>
          </Button>
          <span className="rounded-md border border-border bg-card px-3 py-1 text-sm font-medium">
            {monthLabel(monthStart)}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/app/calendar?month=${nextParam}${empQuery}`}>
              Next →
            </Link>
          </Button>
        </div>
      </div>

      {isAdmin && allEmployees.length > 0 && (
        <form
          action="/app/calendar"
          method="get"
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <input
            type="hidden"
            name="month"
            value={`${monthStart.getFullYear()}-${pad(monthStart.getMonth() + 1)}`}
          />
          <label
            htmlFor="employee-picker"
            className="text-xs uppercase tracking-wider text-muted-foreground"
          >
            Employee:
          </label>
          <select
            id="employee-picker"
            name="employee"
            defaultValue={targetEmployeeId ?? ""}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            {allEmployees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Apply
          </Button>
        </form>
      )}

      {!targetEmployeeId ? (
        <section className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          <p>You don&rsquo;t have a roster row yet. Ask your manager.</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-2 py-2 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const cell = byDay.get(d.iso);
              const dow = (d.date.getDay() + 6) % 7;
              const isWeekend = dow >= 5;
              return (
                <div
                  key={d.iso}
                  className={`min-h-[96px] border-b border-r border-border p-2 last:border-r-0 ${
                    !d.inMonth ? "bg-muted/20 text-muted-foreground" : ""
                  } ${isWeekend && d.inMonth ? "bg-muted/10" : ""}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium tabular-nums">
                      {d.date.getDate()}
                    </span>
                    {cell?.holiday && (
                      <span
                        className="inline-flex items-center rounded-full bg-purple-600 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white"
                        title={cell.holiday.name}
                      >
                        PH
                      </span>
                    )}
                  </div>
                  {cell?.holiday && (
                    <div className="mt-1 truncate text-[10px] text-purple-700 dark:text-purple-300">
                      {cell.holiday.name}
                    </div>
                  )}
                  {cell?.leaveApproved && (
                    <div
                      className={`mt-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${LEAVE_BADGE[cell.leaveApproved.slug] ?? "bg-zinc-600"}`}
                    >
                      {cell.leaveApproved.name}
                    </div>
                  )}
                  {cell?.leavePending && !cell.leaveApproved && (
                    <div
                      className={`mt-1 truncate rounded border-2 border-dashed border-white/40 px-1.5 py-0.5 text-[10px] font-medium text-white ${LEAVE_BADGE[cell.leavePending.slug] ?? "bg-zinc-600"} opacity-70`}
                    >
                      Pending: {cell.leavePending.name}
                    </div>
                  )}
                  {cell?.shiftCount && cell.shiftCount > 0 && (
                    <div className="mt-1 inline-flex items-center rounded-full bg-emerald-600 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white">
                      {cell.shiftCount} shift
                      {cell.shiftCount === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="font-semibold text-foreground">Legend:</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-sky-600" />
          Annual leave
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-rose-600" />
          Personal/Sick
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border-2 border-dashed border-foreground/40" />
          Pending
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-emerald-600" />
          Accepted shift
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-purple-600" />
          Public holiday
        </span>
      </section>
    </div>
  );
}
