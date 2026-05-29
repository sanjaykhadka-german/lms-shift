import Link from "next/link";
import { Avatar } from "~/components/Avatar";
import { fmtTime24 } from "~/lib/date-format";
import type { AreaShift } from "./_area-view";

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
}

interface RowCells {
  key: string;
  fullName: string;
  email: string | null;
  appUserId: string | null;
  isOpenShiftsRow: boolean;
  shiftsByDay: AreaShift[][];
}

function buildRows(
  shifts: AreaShift[],
  employees: EmployeeRow[],
  assignmentsByShift: Map<string, string[]>,
  weekStart: Date,
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
      isOpenShiftsRow: false,
      shiftsByDay: Array.from({ length: 7 }, () => []),
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
    isOpenShiftsRow: true,
    shiftsByDay: Array.from({ length: 7 }, () => []),
  };

  for (const s of shifts) {
    const dayIdx = dayIndexOf(s);
    if (dayIdx < 0 || dayIdx > 6) continue;
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
  shifts,
  employees,
  assignmentsByShift,
}: {
  weekStart: Date;
  shifts: AreaShift[];
  employees: EmployeeRow[];
  assignmentsByShift: Map<string, string[]>;
}) {
  const dayHeaders = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const rows = buildRows(shifts, employees, assignmentsByShift, weekStart);

  // Detect "all empty" — only the open-shifts row exists and that row is
  // empty too. Means literally nothing was scheduled this week.
  const anyShifts = shifts.length > 0 || rows.some((r) => r.shiftsByDay.some((cell) => cell.length > 0));

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
      {/* Header row: blank employee column + 7 day headers */}
      <div className="grid grid-cols-[12rem_repeat(7,minmax(7rem,1fr))] border-b border-border bg-muted/30">
        <div className="border-r border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Employee
        </div>
        {dayHeaders.map((d) => (
          <div
            key={d.toISOString()}
            className="border-r border-border px-2 py-2 text-xs font-semibold last:border-r-0"
          >
            {fmtDayHeader(d)}
          </div>
        ))}
      </div>

      {!anyShifts ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          No shifts this week. Create one with the "New shift" button above.
        </p>
      ) : (
        rows.map((row) => (
          <div
            key={row.key}
            className={`grid grid-cols-[12rem_repeat(7,minmax(7rem,1fr))] border-b border-border last:border-b-0 ${
              row.isOpenShiftsRow ? "bg-[color-mix(in_srgb,var(--warn)_6%,transparent)]" : ""
            }`}
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
                <>
                  <Avatar
                    name={row.fullName}
                    email={row.email ?? ""}
                    image={null}
                    sizeClass="h-7 w-7"
                    textClass="text-[10px]"
                  />
                  <span className="truncate text-xs font-medium">
                    {row.fullName}
                  </span>
                </>
              )}
            </div>

            {/* 7 day cells */}
            {row.shiftsByDay.map((cell, idx) => (
              <div
                key={idx}
                className="min-h-[4.5rem] space-y-1 border-r border-border p-1.5 last:border-r-0"
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
