import Link from "next/link";
import { Avatar } from "~/components/Avatar";
import { fmtTime24 } from "~/lib/date-format";

export interface AreaShift {
  id: string;
  locationId: string | null;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  locationName: string | null;
  locationColor: string | null;
  acceptedCount: number;
  offeredCount: number;
  assigneeName: string | null;
}

interface AreaEmployee {
  id: string;
  fullName: string;
  email: string | null;
}

const STATUS_DOT: Record<string, string> = {
  draft: "var(--ink-3)",
  published: "var(--live)",
  cancelled: "var(--danger)",
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

interface Area {
  key: string;
  locationId: string | null;
  locationName: string | null;
  locationColor: string | null;
  role: string;
  shiftsByDay: AreaShift[][];
}

function buildAreas(shifts: AreaShift[], weekStart: Date): Area[] {
  const map = new Map<string, Area>();
  for (const s of shifts) {
    const key = `${s.locationId ?? ""}|${s.role}`;
    let area = map.get(key);
    if (!area) {
      area = {
        key,
        locationId: s.locationId,
        locationName: s.locationName,
        locationColor: s.locationColor,
        role: s.role,
        shiftsByDay: Array.from({ length: 7 }, () => []),
      };
      map.set(key, area);
    }
    const dayIdx = Math.floor(
      (s.startsAt.getTime() - weekStart.getTime()) / 86_400_000,
    );
    const cell = area.shiftsByDay[dayIdx];
    if (cell) cell.push(s);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ln = (a.locationName ?? "").localeCompare(b.locationName ?? "");
    return ln !== 0 ? ln : a.role.localeCompare(b.role);
  });
}

export function AreaScheduleView({
  weekStart,
  shifts,
  employees,
}: {
  weekStart: Date;
  shifts: AreaShift[];
  employees: AreaEmployee[];
}) {
  const areas = buildAreas(shifts, weekStart);
  const dayHeaders = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="flex gap-3">
      {/* Left rail: employee roster */}
      <aside className="w-48 flex-shrink-0 rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Employees · {employees.length}
        </div>
        <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {employees.length === 0 ? (
            <li className="px-3 py-3 text-xs text-muted-foreground">
              No active employees yet.
            </li>
          ) : (
            employees.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2 px-3 py-2"
              >
                <Avatar
                  name={e.fullName}
                  email={e.email ?? ""}
                  image={null}
                  sizeClass="h-7 w-7"
                  textClass="text-[10px]"
                />
                <span className="truncate text-xs font-medium">
                  {e.fullName}
                </span>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* Right: 7-day area grid */}
      <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        {/* Day-header row */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {dayHeaders.map((d) => (
            <div
              key={d.toISOString()}
              className="border-r border-border px-2 py-2 text-xs font-semibold last:border-r-0"
            >
              {fmtDayHeader(d)}
            </div>
          ))}
        </div>

        {areas.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No shifts this week. Create one with the “New shift” button above.
          </p>
        ) : (
          areas.map((area) => (
            <div key={area.key} className="border-b border-border last:border-b-0">
              {/* Area band header */}
              <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
                {area.locationColor && (
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: area.locationColor }}
                  />
                )}
                <span className="text-xs font-semibold">
                  {area.role}
                </span>
                <span className="text-xs text-muted-foreground">
                  {area.locationName ?? "No location"}
                </span>
              </div>
              {/* 7-day cells for this area */}
              <div className="grid grid-cols-7">
                {area.shiftsByDay.map((cell, idx) => (
                  <div
                    key={idx}
                    className="min-h-[5rem] space-y-1 border-r border-border p-1.5 last:border-r-0"
                  >
                    {cell.map((s) => (
                      <Link
                        key={s.id}
                        href={`/app/schedule/${s.id}/edit`}
                        className="block rounded border border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_12%,transparent)] px-2 py-1 text-[11px] leading-tight hover:bg-[color-mix(in_srgb,var(--live)_20%,transparent)]"
                        style={
                          s.status === "cancelled"
                            ? { opacity: 0.5 }
                            : undefined
                        }
                      >
                        <div className="flex items-center gap-1 font-medium tabular-nums">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                STATUS_DOT[s.status] ?? "var(--ink-3)",
                            }}
                          />
                          {fmtTime24(s.startsAt)} – {fmtTime24(s.endsAt)}
                        </div>
                        <div className="truncate text-muted-foreground">
                          {s.assigneeName ?? "Unassigned"}
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
