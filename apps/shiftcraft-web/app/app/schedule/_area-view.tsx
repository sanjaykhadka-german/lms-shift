"use client";

import {
  type ReactNode,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Avatar } from "~/components/Avatar";
import { fmtTime24 } from "~/lib/date-format";
import {
  assignEmployeeViaDnd,
  copyShiftByDeltaAction,
  copyShiftInPlaceAction,
  moveShiftAction,
} from "./actions";

// Date-bearing shape used by the (server-rendered) employee view.
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

// Serializable shape passed across the server→client boundary to the area
// grid. Never pass Date objects to a client component — epoch-ms only;
// Dates are reconstructed inside.
export interface AreaShiftSer
  extends Omit<AreaShift, "startsAt" | "endsAt"> {
  startsAtMs: number;
  endsAtMs: number;
}

interface AreaEmployee {
  id: string;
  fullName: string;
  email: string | null;
  appUserId: string | null;
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

function buildAreas(
  shifts: AreaShift[],
  weekStart: Date,
  dayCount: number,
): Area[] {
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
        shiftsByDay: Array.from({ length: dayCount }, () => []),
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

// ─── Drag id helpers ───
// emp:<appUserId>   — an employee chip from the left rail (assign on drop)
// shift:<shiftId>   — a shift chip (move on drop, or assign target)
// cell:<areaKey>:<dayIdx> — a day cell (move target)
const empId = (uid: string) => `emp:${uid}`;
const shiftId = (id: string) => `shift:${id}`;
const cellId = (areaKey: string, dayIdx: number) => `cell:${areaKey}:${dayIdx}`;

function DraggableEmployee({ emp }: { emp: AreaEmployee }) {
  const draggable = emp.appUserId != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: empId(emp.appUserId ?? emp.id),
    data: { type: "emp", appUserId: emp.appUserId },
    disabled: !draggable,
  });
  return (
    <li
      ref={setNodeRef}
      {...(draggable ? listeners : {})}
      {...attributes}
      className={`flex items-center gap-2 px-3 py-2 ${
        draggable ? "cursor-grab active:cursor-grabbing" : "opacity-60"
      } ${isDragging ? "opacity-40" : ""}`}
      title={draggable ? "Drag onto a shift to schedule" : "No linked account — can't be scheduled"}
    >
      <Avatar
        name={emp.fullName}
        email={emp.email ?? ""}
        image={null}
        sizeClass="h-7 w-7"
        textClass="text-[10px]"
      />
      <span className="truncate text-xs font-medium">{emp.fullName}</span>
    </li>
  );
}

function ShiftChip({
  shift,
  dayIdx,
  nowMs,
  onCopy,
}: {
  shift: AreaShift;
  dayIdx: number;
  /** Mount-time clock (null until hydrated) so the "started" lock doesn't
   *  cause an SSR/client hydration mismatch. */
  nowMs: number | null;
  onCopy: (shiftId: string) => void;
}) {
  // A started shift can't be moved — disable the drag handle (the server
  // rejects the move too). Assigning staff onto it still works (the drop
  // target stays live).
  const started = nowMs != null && shift.startsAt.getTime() <= nowMs;
  // Draggable (move) + droppable (assign an employee onto it).
  const drag = useDraggable({
    id: shiftId(shift.id),
    data: { type: "shift", shiftId: shift.id, dayIdx },
    disabled: started,
  });
  const drop = useDroppable({
    id: shiftId(shift.id),
    data: { type: "shift", shiftId: shift.id },
  });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={`rounded border px-2 py-1 text-[11px] leading-tight ${
        drop.isOver
          ? "border-[var(--accent-deep)] ring-2 ring-[var(--accent-deep)]"
          : "border-[color-mix(in_srgb,var(--live)_45%,transparent)]"
      } bg-[color-mix(in_srgb,var(--live)_12%,transparent)] ${
        drag.isDragging ? "opacity-40" : ""
      }`}
      style={shift.status === "cancelled" ? { opacity: 0.5 } : undefined}
    >
      <div
        {...(started ? {} : drag.listeners)}
        {...(started ? {} : drag.attributes)}
        className={started ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
        title={started ? "This shift has already started — it can't be moved" : undefined}
      >
        <div className="flex items-center gap-1 font-medium tabular-nums">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: STATUS_DOT[shift.status] ?? "var(--ink-3)" }}
          />
          {fmtTime24(shift.startsAt)} – {fmtTime24(shift.endsAt)}
          {started ? (
            <span
              className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3"
              title="Started — locked"
            >
              ⤿ started
            </span>
          ) : null}
        </div>
        <div className="truncate text-muted-foreground">
          {shift.assigneeName ?? "Unassigned"}
        </div>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <Link
          href={`/app/schedule/${shift.id}/edit`}
          className="inline-block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink"
        >
          Edit →
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCopy(shift.id);
          }}
          title="Duplicate this shift here, then drag the copy to another day"
          className="inline-block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function DayCell({
  areaKey,
  dayIdx,
  children,
}: {
  areaKey: string;
  dayIdx: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cellId(areaKey, dayIdx),
    data: { type: "cell", dayIdx },
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[5rem] space-y-1 border-r border-border p-1.5 last:border-r-0 ${
        dayIdx === 7 ? "border-l-2 border-l-[var(--accent-deep)]" : ""
      } ${
        isOver ? "bg-[color-mix(in_srgb,var(--accent-deep)_10%,transparent)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

interface ShiftMove {
  shiftId: string;
  deltaDays: number;
}

export function AreaScheduleView({
  weekStartMs,
  dayCount = 7,
  shifts: serShifts,
  employees,
}: {
  weekStartMs: number;
  dayCount?: number;
  shifts: AreaShiftSer[];
  employees: AreaEmployee[];
}) {
  // Reconstruct Dates from the serializable props (see AreaShiftSer).
  const weekStart = new Date(weekStartMs);
  const shifts: AreaShift[] = serShifts.map((s) => ({
    ...s,
    startsAt: new Date(s.startsAtMs),
    endsAt: new Date(s.endsAtMs),
  }));
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Mount-time clock used to lock shifts that have started. Starts null so the
  // first client render matches the server (no hydration mismatch), then ticks
  // each minute so a shift locks as its start time passes.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [active, setActive] = useState<
    | { type: "emp"; label: string }
    | { type: "shift"; label: string }
    | null
  >(null);

  // Optimistic shift positions — moving a chip updates its date locally, then
  // the server confirms. Reconciles automatically when revalidated data lands.
  const [optimisticShifts, applyMove] = useOptimistic<AreaShift[], ShiftMove>(
    shifts,
    (state, move) =>
      state.map((s) =>
        s.id === move.shiftId
          ? {
              ...s,
              startsAt: new Date(
                s.startsAt.getTime() + move.deltaDays * 86_400_000,
              ),
              endsAt: new Date(
                s.endsAt.getTime() + move.deltaDays * 86_400_000,
              ),
            }
          : s,
      ),
  );

  const areas = buildAreas(optimisticShifts, weekStart, dayCount);
  const dayHeaders = Array.from({ length: dayCount }, (_, i) =>
    addDays(weekStart, i),
  );
  // Denser columns in the 2-week view so all 14 days fit on screen (the grid
  // flexes to fill the container; the small min keeps chips legible if the
  // viewport is too narrow and it has to scroll).
  const colMin = dayCount > 7 ? "4rem" : "7rem";
  const gridCols = {
    gridTemplateColumns: `repeat(${dayCount}, minmax(${colMin}, 1fr))`,
  };
  // Visual divider at the start of week 2 (14-day view only).
  const weekDivider = (i: number) =>
    i === 7 ? "border-l-2 border-l-[var(--accent-deep)]" : "";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("emp:")) {
      const emp = employees.find((e) => empId(e.appUserId ?? e.id) === id);
      setActive(emp ? { type: "emp", label: emp.fullName } : null);
    } else if (id.startsWith("shift:")) {
      const s = optimisticShifts.find((x) => shiftId(x.id) === id);
      setActive(
        s
          ? { type: "shift", label: `${fmtTime24(s.startsAt)} · ${s.role}` }
          : null,
      );
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActive(null);
    setError(null);
    const { active: a, over } = event;
    if (!over) return;

    // Employee dragged onto a shift chip → schedule (auto-approved).
    if (a.data.current?.type === "emp" && over.data.current?.type === "shift") {
      const appUserId = a.data.current.appUserId as string | null;
      const targetShiftId = over.data.current.shiftId as string;
      if (!appUserId) {
        setError("That person has no linked account and can't be scheduled.");
        return;
      }
      startTransition(async () => {
        const res = await assignEmployeeViaDnd(targetShiftId, appUserId);
        if (res.status === "error") setError(res.message);
        router.refresh();
      });
      return;
    }

    // Shift dragged onto a day cell. Dropping on a PAST date (before today)
    // copies the shift there and leaves the original in place; today/future
    // moves it as before.
    if (a.data.current?.type === "shift" && over.data.current?.type === "cell") {
      const movedShiftId = a.data.current.shiftId as string;
      const sourceDayIdx = a.data.current.dayIdx as number;
      const targetDayIdx = over.data.current.dayIdx as number;
      const deltaDays = targetDayIdx - sourceDayIdx;
      if (deltaDays === 0) return;

      const targetDate = addDays(weekStart, targetDayIdx);
      targetDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isPast = targetDate.getTime() < today.getTime();

      if (isPast) {
        startTransition(async () => {
          const res = await copyShiftByDeltaAction(movedShiftId, deltaDays);
          if (!res.ok) setError(res.message ?? "Couldn't copy that shift.");
          router.refresh();
        });
        return;
      }

      startTransition(async () => {
        applyMove({ shiftId: movedShiftId, deltaDays });
        const res = await moveShiftAction(movedShiftId, deltaDays);
        if (!res.ok) setError(res.message ?? "Couldn't move that shift.");
        router.refresh();
      });
    }
  }

  // "Copy" button on a shift chip: duplicate it in place, then refresh so the
  // copy appears next to the original — ready to drag onto another day.
  function handleCopy(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await copyShiftInPlaceAction(id);
      if (!res.ok) setError(res.message ?? "Couldn't copy that shift.");
      router.refresh();
    });
  }

  return (
    <DndContext
      id="schedule-area-dnd"
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {error && (
        <p className="mb-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--danger)]">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        {/* Left rail: employee roster — drag a name onto a shift to schedule */}
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
              employees.map((e) => <DraggableEmployee key={e.id} emp={e} />)
            )}
          </ul>
        </aside>

        {/* Right: N-day area grid */}
        <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <div className="grid border-b border-border bg-muted/30" style={gridCols}>
            {dayHeaders.map((d, i) => (
              <div
                key={d.toISOString()}
                className={`border-r border-border px-2 py-2 text-xs font-semibold last:border-r-0 ${weekDivider(i)}`}
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
                <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5">
                  {area.locationColor && (
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: area.locationColor }}
                    />
                  )}
                  <span className="text-xs font-semibold">{area.role}</span>
                  <span className="text-xs text-muted-foreground">
                    {area.locationName ?? "No location"}
                  </span>
                </div>
                <div className="grid" style={gridCols}>
                  {area.shiftsByDay.map((cell, idx) => (
                    <DayCell key={idx} areaKey={area.key} dayIdx={idx}>
                      {cell.map((s) => (
                        <ShiftChip
                          key={s.id}
                          shift={s}
                          dayIdx={idx}
                          nowMs={nowMs}
                          onCopy={handleCopy}
                        />
                      ))}
                    </DayCell>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <DragOverlay>
        {active ? (
          <div className="rounded border border-[var(--accent-deep)] bg-[var(--paper)] px-2 py-1 text-[11px] font-medium shadow-lg">
            {active.label}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
