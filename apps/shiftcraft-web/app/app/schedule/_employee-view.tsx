import Link from "next/link";
import { fmtTime24 } from "~/lib/date-format";
import type { AreaShift } from "./_area-view";
import { EmployeeSummaryCell } from "./_employee-summary";

// Per-employee totals for the summary modal. Gross scheduled time (end − start)
// across all non-cancelled shifts in the visible range.
function rowShiftsForTotals(row: { shiftsByDay: AreaShift[][] }): AreaShift[] {
  return row.shiftsByDay.flat().filter((s) => s.status !== "cancelled");
}
function rowTotalMs(row: { shiftsByDay: AreaShift[][] }): number {
  return rowShiftsForTotals(row).reduce(
    (acc, s) => acc + (s.endsAt.getTime() - s.startsAt.getTime()),
    0,
  );
}
function rowShiftCount(row: { shiftsByDay: AreaShift[][] }): number {
  return rowShiftsForTotals(row).length;
}

// Per-employee row schedule. Same shift payload as the Area view, but
// pivoted: rows = employees (plus a pinned "Open shifts" row at top),
// columns = Mon → Sun. A shift lands in (userId, dayIdx) when the
// userId appears in `assignmentsByShift` for status='accepted'; shifts
// with no accepted assignee land in the Open shifts row.

const STATUS_DOT: Record<string, string> = {
  draft: "bg-[var(--ink-3)]",
  published: "bg-[var(--live)]",
  cancelled: "bg-[var(--danger)]",
};

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDayHeader(d: Date): string {
  return `${WEEKDAY_ABBR[d.getDay()] ?? ""} ${d.getDate()}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export interface EmployeeRow {
  id: string;
  fullName: string;
  email: string | null;
  appUserId: string | null;
  hourlyRate: string | null;
}

interface RowCells {
  key: string;
  fullName: string;
  email: string | null;
  appUserId: string | null;
  hourlyRate: string | null;
  isOpenShiftsRow: boolean;
  shiftsByDay: AreaShift[][];
}

function buildRows(
  shifts: AreaShift[],
  employees: EmployeeRow[],
  assignmentsByShift: Map<string, string[]>,
  weekStart: Date,
  dayCount: number,
): RowCells[] {
  const dayIndexOf = (s: AreaShift) =>
    Math.floor((s.startsAt.getTime() - weekStart.getTime()) / 86_400_000);

  // Each shift can be assigned to >=0 employees. Visit each (shift, userId)
  // pairing, push into that user's row+day cell. Shifts with no accepted
  // userId go to the synthetic "Open shifts" row.
  const empById = new Map<string, RowCells>();
  for (const e of employees) {
    empById.set(e.id, {
      key: `emp:${e.id}`,
      fullName: e.fullName,
      email: e.email,
      appUserId: e.appUserId,
      hourlyRate: e.hourlyRate,
      isOpenShiftsRow: false,
      shiftsByDay: Array.from({ length: dayCount }, () => []),
    });
  }
  const empByUserId = new Map<string, RowCells>();
  for (const e of employees) {
    if (e.appUserId) empByUserId.set(e.appUserId, empById.get(e.id)!);
  }

  const openRow: RowCells = {
    key: "open",
    fullName: "Open shifts",
    email: null,
    appUserId: null,
    hourlyRate: null,
    isOpenShiftsRow: true,
    shiftsByDay: Array.from({ length: dayCount }, () => []),
  };

  for (const s of shifts) {
    const dayIdx = dayIndexOf(s);
    if (dayIdx < 0 || dayIdx >= dayCount) continue;
    const acceptedUserIds = assignmentsByShift.get(s.id) ?? [];
    if (acceptedUserIds.length === 0) {
      openRow.shiftsByDay[dayIdx]!.push(s);
      continue;
    }
    for (const uid of acceptedUserIds) {
      const row = empByUserId.get(uid);
      if (row) row.shiftsByDay[dayIdx]!.push(s);
    }
  }

  // Sort employees by name; open shifts row pinned to the top.
  const sortedEmployees = [...empById.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
  return [openRow, ...sortedEmployees];
}

export function EmployeeScheduleView({
  weekStart,
  dayCount = 7,
  shifts,
  employees,
  assignmentsByShift,
  holidayNames = [],
}: {
  weekStart: Date;
  dayCount?: number;
  shifts: AreaShift[];
  employees: EmployeeRow[];
  assignmentsByShift: Map<string, string[]>;
  /** Public-holiday name per day index (Mon-indexed), or null (item 9). */
  holidayNames?: Array<string | null>;
}) {
  const dayHeaders = Array.from({ length: dayCount }, (_, i) =>
    addDays(weekStart, i),
  );
  const rows = buildRows(shifts, employees, assignmentsByShift, weekStart, dayCount);
  // In the 2-week view, shrink columns (and the employee rail) so all 14 days
  // fit on screen without horizontal scrolling.
  const twoWeek = dayCount > 7;
  const colMin = twoWeek ? "4rem" : "7rem";
  const railWidth = twoWeek ? "8.5rem" : "12rem";
  const gridCols = {
    gridTemplateColumns: `${railWidth} repeat(${dayCount}, minmax(${colMin}, 1fr))`,
  };
  const weekDivider = (i: number) =>
    i === 7 ? "border-l-2 border-l-[var(--accent-deep)]" : "";

  // Detect "all empty" — only the open-shifts row exists and that row is
  // empty too. Means literally nothing was scheduled this week.
  const anyShifts = shifts.length > 0 || rows.some((r) => r.shiftsByDay.some((cell) => cell.length > 0));

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      {/* Header row: blank employee column + N day headers */}
      <div
        className="grid border-b border-border bg-muted/30"
        style={gridCols}
      >
        <div className="border-r border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Employee
        </div>
        {dayHeaders.map((d, i) => {
          const holiday = holidayNames[i] ?? null;
          return (
            <div
              key={d.toISOString()}
              className={`border-r border-border px-2 py-2 text-xs font-semibold last:border-r-0 ${weekDivider(i)} ${
                holiday
                  ? "bg-[color-mix(in_srgb,var(--accent-deep)_12%,transparent)]"
                  : ""
              }`}
              title={holiday ? `Public holiday: ${holiday}` : undefined}
            >
              {fmtDayHeader(d)}
              {holiday ? (
                <span className="mt-0.5 block truncate text-[10px] font-medium leading-tight text-[var(--accent-deep)]">
                  🎉 {holiday}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {!anyShifts ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No shifts this week. Create one with the "New shift" button above.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            className={`grid border-b border-border last:border-b-0 ${
              row.isOpenShiftsRow ? "bg-[color-mix(in_srgb,var(--warn)_6%,transparent)]" : ""
            }`}
            style={gridCols}
          >
            {/* Left-rail cell: employee name + avatar (or "Open shifts" label) */}
            <div className="flex items-center gap-2 border-r border-border px-3 py-2">
              {row.isOpenShiftsRow ? (
                <>
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full bg-[var(--warn)]"
                  />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--warn)]">
                    {row.fullName}
                  </span>
                </>
              ) : (
                <EmployeeSummaryCell
                  fullName={row.fullName}
                  email={row.email}
                  hourlyRate={row.hourlyRate}
                  totalMs={rowTotalMs(row)}
                  shiftCount={rowShiftCount(row)}
                  rangeLabel={twoWeek ? "Fortnight total" : "Week total"}
                />
              )}
            </div>

            {/* 7 day cells */}
            {row.shiftsByDay.map((cell, idx) => (
              <div
                key={idx}
                className={`min-h-[4.5rem] space-y-1 border-r border-border last:border-r-0 ${twoWeek ? "p-1" : "p-1.5"} ${weekDivider(idx)}`}
              >
                {cell.map((s) => (
                  <Link
                    key={s.id}
                    href={`/app/schedule/${s.id}/edit`}
                    className={
                      row.isOpenShiftsRow
                        ? "block rounded border border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] px-2 py-1 text-[11px] leading-tight hover:bg-[color-mix(in_srgb,var(--warn)_22%,transparent)]"
                        : "block rounded border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_12%,transparent)] px-2 py-1 text-[11px] leading-tight hover:bg-[color-mix(in_srgb,var(--live)_20%,transparent)]"
                    }
                    style={
                      s.status === "cancelled" ? { opacity: 0.5 } : undefined
                    }
                  >
                    <div className="flex items-center gap-1 font-medium tabular-nums">
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                          STATUS_DOT[s.status] ?? "bg-[var(--ink-3)]"
                        }`}
                      />
                      {fmtTime24(s.startsAt)} – {fmtTime24(s.endsAt)}
                      {s.needsPublish && s.status === "published" ? (
                        <span
                          className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] px-1.5 font-mono text-[8px] uppercase tracking-[0.06em] text-[var(--warn)]"
                          title="Edited since it was published — re-publish to push the change to staff"
                        >
                          edited
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {s.role}
                      {s.locationName ? ` · ${s.locationName}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
