"use client";

import {
  type ReactNode,
  useEffect,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import type { BulkCopyTarget } from "./_bulk-copy";
import {
  assignEmployeeViaDnd,
  bulkCopyShiftsAction,
  copyShiftByDeltaAction,
  copyShiftInPlaceAction,
  createAndAssignViaDnd,
  moveShiftAction,
  moveShiftToAreaAction,
} from "./actions";
import { CommentBadge } from "./_comment-badge";

// Date-bearing shape used by the (server-rendered) employee view.
export interface AreaShift {
  id: string;
  locationId: string | null;
  role: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  /** Free-text shift note (sc_shifts.notes). Surfaced on the card so a
   *  placeholder like "GUNNAR (pending)" is visible on the grid, not just in
   *  the edit modal (Kati's rostering feedback #5). */
  notes: string | null;
  /** True when this shift has changes not yet published (a draft, or a
   *  published shift edited since it last went live). Drives the "edited"
   *  badge; computed server-side. */
  needsPublish: boolean;
  /** True when this past, published shift had an accepted assignee who never
   *  clocked in around the shift window — a no-show (item 10). Computed
   *  server-side. */
  noShow?: boolean;
  /** Internal shift-comment preview (manager-only). commentCount 0 = no
   *  indicator; latestComment/author drive the hover popover (item: see a
   *  shift's internal comment without opening it). */
  commentCount?: number;
  latestComment?: string | null;
  latestCommentAuthor?: string | null;
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

// Mon-start week + ISO date. Defined locally (not imported from ~/lib/clock,
// which is "server-only") so this client component stays out of the server
// bundle. Mirrors the same logic.
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - dow);
  return r;
}

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function DraggableEmployee({
  emp,
  active,
  onSelect,
}: {
  emp: AreaEmployee;
  /** True when the grid is currently filtered to this person. */
  active: boolean;
  /** Click (not drag) → filter the calendar to this employee. Only wired for
   *  linked accounts (assignments key on appUserId). */
  onSelect: (() => void) | null;
}) {
  // Kati's rostering feedback #2 — everyone is draggable now, including
  // un-onboarded staff with no app login: dragging them onto a cell pencils
  // their name in as a placeholder note (they can't hold a real assignment).
  const linked = emp.appUserId != null;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: empId(emp.appUserId ?? emp.id),
    data: { type: "emp", appUserId: emp.appUserId, empName: emp.fullName },
    disabled: false,
  });
  return (
    <li
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect ?? undefined}
      className={`flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing ${
        linked ? "" : "opacity-70"
      } ${isDragging ? "opacity-40" : ""} ${
        active
          ? "bg-[color-mix(in_srgb,var(--accent-deep)_16%,transparent)] ring-1 ring-inset ring-[var(--accent-deep)]"
          : onSelect
            ? "hover:bg-muted/40"
            : ""
      }`}
      title={
        linked
          ? active
            ? "Showing this person — click to clear"
            : "Click to view this person's shifts · drag onto a shift or empty day to schedule"
          : "No app login yet — drag onto an empty day to pencil them in as a placeholder"
      }
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
  dense,
  selectMode,
  selected,
  onCopy,
  onToggleSelect,
}: {
  shift: AreaShift;
  dayIdx: number;
  /** Mount-time clock (null until hydrated) so the "started" lock doesn't
   *  cause an SSR/client hydration mismatch. */
  nowMs: number | null;
  /** 2-week view: render a compact pill (no time wrap, hover-revealed actions). */
  dense: boolean;
  /** Multi-select mode: chip becomes a checkbox toggle, drag + actions off. */
  selectMode: boolean;
  selected: boolean;
  onCopy: (shiftId: string, carryPerson?: boolean) => void;
  onToggleSelect: (shiftId: string) => void;
}) {
  // A started shift can't be moved — disable the drag handle (the server
  // rejects the move too). Assigning staff onto it still works (the drop
  // target stays live).
  const started = nowMs != null && shift.startsAt.getTime() <= nowMs;
  // Draggable (move) + droppable (assign an employee onto it). Drag is
  // suppressed while selecting so a click reliably toggles selection.
  const drag = useDraggable({
    id: shiftId(shift.id),
    // locationId + role let the drop handler detect a cross-area move (item 3).
    data: {
      type: "shift",
      shiftId: shift.id,
      dayIdx,
      locationId: shift.locationId,
      role: shift.role,
    },
    disabled: started || selectMode,
  });
  const drop = useDroppable({
    id: shiftId(shift.id),
    data: { type: "shift", shiftId: shift.id },
    // A started/past shift can't have its roster changed (server rejects it
    // too), so it rejects assign-drops outright — no drop, no error toast.
    disabled: selectMode || started,
  });

  // Dense 2-week view: the action row (Edit / Copy / +person) is hover-only,
  // so it's unreachable on touch devices. Tapping the chip body toggles it
  // open. (In 1-week view the row is always shown and this is unused.)
  const [revealed, setRevealed] = useState(false);

  const pad = dense ? "px-1.5 py-0.5" : "px-2 py-1";
  // 2-week view shows a dept color bar on the left edge of the pill.
  const deptBar =
    dense && shift.locationColor
      ? { borderLeftWidth: "3px", borderLeftColor: shift.locationColor }
      : undefined;

  const timeLabel = `${fmtTime24(shift.startsAt)}–${fmtTime24(shift.endsAt)}`;

  // Dense (2-week): one tight monospace line, no inline badges (they wrap and
  // overflow the ~5rem column). Status/edited/started detail lives in the 1-week
  // view + edit page; the left dept bar + cancelled dimming carry here.
  const timeRange = dense ? (
    // Kati's rostering feedback #6 — a persistent draft/published/cancelled dot
    // in the dense 2-week view (the rest of the status detail stays hover-only).
    <div
      className="flex items-center gap-1 truncate font-mono text-[10px] font-medium leading-tight tabular-nums"
      title={timeLabel}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_DOT[shift.status] ?? "var(--ink-3)" }}
      />
      <span className="truncate">{timeLabel}</span>
    </div>
  ) : (
    <div className="flex items-center gap-1 font-medium tabular-nums">
      <span
        aria-hidden
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: STATUS_DOT[shift.status] ?? "var(--ink-3)" }}
      />
      {timeLabel}
      {shift.needsPublish && shift.status === "published" ? (
        <span
          className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--warn)_18%,transparent)] px-1.5 font-mono text-[8px] uppercase tracking-[0.06em] text-[var(--warn)]"
          title="Edited since it was published — re-publish to push the change to staff"
        >
          edited
        </span>
      ) : null}
      {started ? (
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.08em] text-ink-3 ${
            shift.needsPublish && shift.status === "published" ? "ml-1" : "ml-auto"
          }`}
          title="Started — locked"
        >
          ⤿ started
        </span>
      ) : null}
    </div>
  );

  const assignee = (
    <div className={`flex items-center gap-1 ${dense ? "text-[10px] leading-tight" : ""}`}>
      <span
        className={`truncate ${shift.assigneeName ? "" : "text-muted-foreground"}`}
        title={shift.assigneeName ?? "Unassigned"}
      >
        {shift.assigneeName ?? "Unassigned"}
      </span>
      {shift.noShow ? (
        <span
          className="shrink-0 rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white"
          title="Scheduled but never clocked in around this shift — no-show"
        >
          No-show
        </span>
      ) : null}
      <CommentBadge
        count={shift.commentCount}
        latest={shift.latestComment}
        author={shift.latestCommentAuthor}
      />
    </div>
  );

  // Kati's rostering feedback #5 — show the shift note on the card (e.g. a
  // "GUNNAR (pending)" placeholder for a not-yet-onboarded hire). Tight in the
  // dense 2-week pill, so there it's a title tooltip only; shown inline in 1wk.
  const notesLine =
    shift.notes && !dense ? (
      <div
        className="mt-0.5 truncate text-[10px] italic text-ink-3"
        title={shift.notes}
      >
        {shift.notes}
      </div>
    ) : null;

  // ── Select mode: the whole chip is a checkbox toggle (no drag/edit/copy) ──
  if (selectMode) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect(shift.id)}
        aria-pressed={selected}
        className={`flex w-full items-start gap-1.5 overflow-hidden rounded border text-left ${pad} text-[11px] leading-tight ${
          selected
            ? "border-[var(--accent-deep)] ring-2 ring-[var(--accent-deep)]"
            : "border-[color-mix(in_srgb,var(--live)_45%,transparent)]"
        } bg-[color-mix(in_srgb,var(--live)_12%,transparent)] cursor-pointer`}
        style={shift.status === "cancelled" ? { opacity: 0.5, ...deptBar } : deptBar}
      >
        <span
          aria-hidden
          className={`mt-0.5 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-sm border text-[9px] leading-none ${
            selected
              ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white"
              : "border-current text-transparent"
          }`}
        >
          ✓
        </span>
        <span className="min-w-0 flex-1">
          {timeRange}
          {assignee}
          {notesLine}
        </span>
      </button>
    );
  }

  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={`group overflow-hidden rounded border ${pad} text-[11px] leading-tight ${
        drop.isOver
          ? "border-[var(--accent-deep)] ring-2 ring-[var(--accent-deep)]"
          : "border-[color-mix(in_srgb,var(--live)_45%,transparent)]"
      } bg-[color-mix(in_srgb,var(--live)_12%,transparent)] ${
        drag.isDragging ? "opacity-40" : ""
      }`}
      style={shift.status === "cancelled" ? { opacity: 0.5, ...deptBar } : deptBar}
    >
      <div
        {...(started ? {} : drag.listeners)}
        {...(started ? {} : drag.attributes)}
        onClick={dense ? () => setRevealed((v) => !v) : undefined}
        className={started ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
        title={
          started
            ? "This shift has already started — it can't be moved"
            : dense
              ? "Tap to show Edit / Copy / +person"
              : undefined
        }
      >
        {timeRange}
        {assignee}
        {notesLine}
      </div>
      <div
        className={`mt-0.5 items-center gap-2 ${
          dense
            ? revealed
              ? "flex"
              : "hidden group-hover:flex group-focus-within:flex"
            : "flex"
        }`}
      >
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
        {shift.assigneeName ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(shift.id, true);
            }}
            title="Copy this shift with the person on it, then drag the copy to another day"
            className="inline-block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3 hover:text-ink"
          >
            +person
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DayCell({
  areaKey,
  dayIdx,
  dense,
  locationId,
  role,
  isPast,
  children,
}: {
  areaKey: string;
  dayIdx: number;
  /** 2-week view: tighter cell so 4–5 dense pills fit without overflow. */
  dense: boolean;
  /** This area's location + role — carried in the droppable data so dropping
   *  an employee here can create a shift in the right area (Kati #2). */
  locationId: string | null;
  role: string;
  /** Day is before today — reject drops (no past-dated rostering). */
  isPast: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cellId(areaKey, dayIdx),
    data: { type: "cell", dayIdx, locationId, role },
    disabled: isPast,
  });
  return (
    <div
      ref={setNodeRef}
      className={`border-r border-border last:border-r-0 ${
        dense ? "min-h-[3.5rem] space-y-0.5 p-1" : "min-h-[5rem] space-y-1 p-1.5"
      } ${
        dayIdx === 7 ? "border-l-2 border-l-[var(--accent-deep)]" : ""
      } ${
        isOver ? "bg-[color-mix(in_srgb,var(--accent-deep)_10%,transparent)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

// Floating action bar shown while ≥1 shift is selected. Owns the picker input
// values for the "Copy to" menu; commits a BulkCopyTarget via onCopy.
function BulkCopyBar({
  count,
  weekStartMs,
  areaOptions,
  open,
  setOpen,
  onCopy,
  onClear,
}: {
  count: number;
  weekStartMs: number;
  areaOptions: Array<{
    value: string;
    label: string;
    locationId: string;
    role: string;
  }>;
  open: boolean;
  setOpen: (v: boolean) => void;
  onCopy: (target: BulkCopyTarget, carryAssignees: boolean) => void;
  onClear: () => void;
}) {
  // Sensible defaults: a day/week one week ahead of the week in view.
  const nextWeekStart = startOfWeek(addDays(new Date(weekStartMs), 7));
  const defaultDay = fmtIsoDate(addDays(new Date(weekStartMs), 7));
  const [fromVal, setFromVal] = useState(() => defaultDay);
  const [toVal, setToVal] = useState(() => defaultDay);
  const [weekVal, setWeekVal] = useState(() => fmtIsoDate(nextWeekStart));
  const [areaVal, setAreaVal] = useState(areaOptions[0]?.value ?? "");
  // Carry the assigned employee onto the copies (Deputy-style). Default on.
  const [carry, setCarry] = useState(true);

  const inputCls =
    "h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-xs text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]";
  const goCls =
    "inline-flex h-8 items-center rounded-md bg-[var(--accent-deep)] px-2.5 text-xs font-medium text-white hover:opacity-90";
  const rowCls = "flex items-center justify-between gap-2 px-3 py-2";

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      {open && (
        <div className="mb-2 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Copy {count} shift{count === 1 ? "" : "s"} to…
          </div>
          {/* A date range — copies onto every day from→to (same day = one day) */}
          <div className="space-y-1.5 px-3 py-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Date range
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={fromVal}
                onChange={(e) => {
                  setFromVal(e.target.value);
                  // keep `to` ≥ `from` for a sane default
                  if (toVal < e.target.value) setToVal(e.target.value);
                }}
                aria-label="From date"
                className={`${inputCls} min-w-0 flex-1`}
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={toVal}
                min={fromVal}
                onChange={(e) => setToVal(e.target.value)}
                aria-label="To date"
                className={`${inputCls} min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={!fromVal || !toVal}
                onClick={() =>
                  onCopy({ kind: "dateRange", from: fromVal, to: toVal }, carry)
                }
                className={goCls}
              >
                Copy
              </button>
            </div>
          </div>
          {/* An entire week (Mon-start) */}
          <div className={rowCls}>
            <input
              type="date"
              value={weekVal}
              onChange={(e) => setWeekVal(e.target.value)}
              aria-label="Target week (any day; snaps to that week)"
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              disabled={!weekVal}
              onClick={() =>
                onCopy(
                  {
                    kind: "week",
                    weekStart: fmtIsoDate(
                      startOfWeek(new Date(`${weekVal}T00:00:00`)),
                    ),
                  },
                  carry,
                )
              }
              className={goCls}
            >
              Week
            </button>
          </div>
          {/* Another area (location + area name) */}
          {areaOptions.length > 0 && (
            <div className={rowCls}>
              <select
                value={areaVal}
                onChange={(e) => setAreaVal(e.target.value)}
                aria-label="Target area"
                className={`${inputCls} flex-1`}
              >
                {areaOptions.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!areaVal}
                onClick={() => {
                  const a = areaOptions.find((o) => o.value === areaVal);
                  if (a)
                    onCopy(
                      { kind: "area", locationId: a.locationId, role: a.role },
                      carry,
                    );
                }}
                className={goCls}
              >
                Area
              </button>
            </div>
          )}
          {/* Carry the assigned employee onto the copies */}
          <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={carry}
              onChange={(e) => setCarry(e.target.checked)}
              className="accent-[var(--accent-deep)]"
            />
            Also copy the assigned employee
          </label>
        </div>
      )}
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 shadow-lg">
        <span className="text-sm font-medium">
          {count} shift{count === 1 ? "" : "s"} selected
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--accent-deep)] px-3 text-sm font-medium text-white hover:opacity-90"
        >
          Copy to ▾
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-muted-foreground hover:text-ink"
        >
          Clear
        </button>
      </div>
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
  holidayNames = [],
}: {
  weekStartMs: number;
  dayCount?: number;
  shifts: AreaShiftSer[];
  employees: AreaEmployee[];
  /** Public-holiday name per day index (Mon-indexed), or null (item 9). */
  holidayNames?: Array<string | null>;
}) {
  // Reconstruct Dates from the serializable props (see AreaShiftSer).
  const weekStart = new Date(weekStartMs);
  const shifts: AreaShift[] = serShifts.map((s) => ({
    ...s,
    startsAt: new Date(s.startsAtMs),
    endsAt: new Date(s.endsAtMs),
  }));
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Clicking a name in the roster filters the grid to that employee (toggle).
  const activeEmployee = searchParams.get("employee");
  function selectEmployee(appUserId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("employee") === appUserId) params.delete("employee");
    else params.set("employee", appUserId);
    const s = params.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Soft, non-blocking notice (e.g. "not trained for this area" — items 4 & 7).
  // The action still succeeded; this is amber guidance, not a red failure.
  const [warning, setWarning] = useState<string | null>(null);
  // Mount-time clock used to lock shifts that have started. Starts null so the
  // first client render matches the server (no hydration mismatch), then ticks
  // each minute so a shift locks as its start time passes.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  // Start-of-today (local), derived from the hydrated clock. Past day cells are
  // made non-droppable so you can't drag anything onto a day that's already
  // gone. Null until hydrated → cells stay droppable on the server render (no
  // mismatch); dragging only happens client-side after hydration anyway.
  let todayStartMs: number | null = null;
  if (nowMs != null) {
    const d = new Date(nowMs);
    d.setHours(0, 0, 0, 0);
    todayStartMs = d.getTime();
  }
  const [active, setActive] = useState<
    | { type: "emp"; label: string }
    | { type: "shift"; label: string }
    | null
  >(null);

  // ── Multi-select + bulk copy (local UI state only) ──
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  // Lightweight self-dismissing "toast" (no toast lib in this app). Tone
  // distinguishes a success ("ok", green, short) from a caution ("warn",
  // amber, longer) such as a double-booking heads-up.
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "warn" } | null>(
    null,
  );

  const clearSelection = () => {
    setSelected(new Set());
    setMenuOpen(false);
  };
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelectMode = () => {
    setSelectMode(false);
    clearSelection();
  };

  // Esc clears the current selection / closes the menu.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && (menuOpen || selected.size > 0)) {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, selected.size]);

  // Auto-dismiss the toast. Warnings linger longer so they're not missed.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.tone === "warn" ? 7000 : 3000);
    return () => clearTimeout(t);
  }, [flash]);

  function runBulkCopy(target: BulkCopyTarget, carryAssignees: boolean) {
    const shiftIds = Array.from(selected);
    if (shiftIds.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkCopyShiftsAction({ shiftIds, target, carryAssignees });
      if (!res.ok) {
        setError(res.message ?? "Couldn't copy those shifts.");
        return;
      }
      setFlash({
        text: `Copied ${res.copied} shift${res.copied === 1 ? "" : "s"}`,
        tone: "ok",
      });
      clearSelection();
      router.refresh();
    });
  }

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
  // 2-week view: render compact pills (Feature 2).
  const dense = dayCount > 7;
  // Area (= location + role) options for the "Another area…" bulk-copy target,
  // derived from the areas already in the grid view.
  const areaOptions = areas
    .filter((a) => a.locationId)
    .map((a) => ({
      value: `${a.locationId}|${a.role}`,
      label: `${a.role} · ${a.locationName ?? "No location"}`,
      locationId: a.locationId as string,
      role: a.role,
    }));
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

  // Soft notice when a shift lands on a public-holiday day (item 9) — never
  // blocks, just flags that penalty rates may apply. Null on a normal day.
  const holidayNote = (dayIdx: number): string | null => {
    const name = holidayNames[dayIdx] ?? null;
    return name
      ? `Heads up — that day is a public holiday (${name}). Penalty rates may apply.`
      : null;
  };

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
    setWarning(null);
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
        else if (res.warning) setWarning(res.warning);
        router.refresh();
      });
      return;
    }

    // Employee dragged onto an EMPTY day cell → create a draft shift in that
    // area (default 09:00–17:00) and assign them (Kati's rostering feedback
    // #2). Un-linked staff (no appUserId) get pencilled in as a placeholder
    // note instead of a real assignment.
    if (a.data.current?.type === "emp" && over.data.current?.type === "cell") {
      const appUserId = a.data.current.appUserId as string | null;
      const empName = (a.data.current.empName as string | null) ?? null;
      const targetDayIdx = over.data.current.dayIdx as number;
      const locationId = over.data.current.locationId as string | null;
      const role = over.data.current.role as string;
      if (!locationId) {
        setError("This area has no location — add one before scheduling here.");
        return;
      }
      const dateIso = fmtIsoDate(addDays(weekStart, targetDayIdx));
      startTransition(async () => {
        const res = await createAndAssignViaDnd(
          dateIso,
          locationId,
          role,
          appUserId,
          appUserId ? null : empName,
        );
        if (!res.ok) setError(res.message ?? "Couldn't create that shift.");
        else setWarning(res.warning ?? holidayNote(targetDayIdx));
        router.refresh();
      });
      return;
    }

    // Shift dragged onto a day cell. Today/future moves it. Dropping on a PAST
    // date is refused server-side (Kati's rostering feedback #4 — no past-dated
    // rosters); the copy action returns {ok:false} and we surface the message.
    if (a.data.current?.type === "shift" && over.data.current?.type === "cell") {
      const movedShiftId = a.data.current.shiftId as string;
      const sourceDayIdx = a.data.current.dayIdx as number;
      const sourceLocationId = (a.data.current.locationId as string | null) ?? null;
      const sourceRole = a.data.current.role as string;
      const targetDayIdx = over.data.current.dayIdx as number;
      const targetLocationId = (over.data.current.locationId as string | null) ?? null;
      const targetRole = over.data.current.role as string;
      const deltaDays = targetDayIdx - sourceDayIdx;
      // Item 3: dropping on a different area row reassigns the shift's
      // location + role (not just its day).
      const areaChanged =
        targetLocationId !== sourceLocationId || targetRole !== sourceRole;
      if (deltaDays === 0 && !areaChanged) return;

      const targetDate = addDays(weekStart, targetDayIdx);
      targetDate.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const isPast = targetDate.getTime() < today.getTime();

      if (isPast) {
        // Past-dated rosters are read-only (Kati #4); fall back to a same-area
        // copy. Cross-area reassignment onto a past day isn't supported.
        startTransition(async () => {
          const res = await copyShiftByDeltaAction(movedShiftId, deltaDays);
          if (!res.ok) setError(res.message ?? "Couldn't copy that shift.");
          router.refresh();
        });
        return;
      }

      if (areaChanged) {
        if (!targetLocationId) {
          setError("This area has no location — add one before scheduling here.");
          return;
        }
        startTransition(async () => {
          const res = await moveShiftToAreaAction({
            shiftId: movedShiftId,
            deltaDays,
            locationId: targetLocationId,
            role: targetRole,
          });
          if (!res.ok) setError(res.message ?? "Couldn't move that shift.");
          else setWarning(res.warning ?? holidayNote(targetDayIdx));
          router.refresh();
        });
        return;
      }

      startTransition(async () => {
        applyMove({ shiftId: movedShiftId, deltaDays });
        const res = await moveShiftAction(movedShiftId, deltaDays);
        if (!res.ok) setError(res.message ?? "Couldn't move that shift.");
        else setWarning(holidayNote(targetDayIdx));
        router.refresh();
      });
    }
  }

  // "Copy" button on a shift chip: duplicate it in place, then refresh so the
  // copy appears next to the original — ready to drag onto another day.
  // carryPerson = Kati's #2.B "Copy (keep person)": the copy keeps the
  // assignee so dragging it to another day moves the person with it.
  function handleCopy(id: string, carryPerson = false) {
    setError(null);
    startTransition(async () => {
      const res = await copyShiftInPlaceAction(id, carryPerson);
      if (!res.ok) setError(res.message ?? "Couldn't copy that shift.");
      else if (res.warning) setFlash({ text: res.warning, tone: "warn" });
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
      {warning && (
        <p className="mb-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-1.5 text-xs font-medium text-ink">
          {warning}
        </p>
      )}

      {/* Select toggle — turns the grid into a multi-select surface so shifts
          can be bulk-copied (Feature 1). */}
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          aria-pressed={selectMode}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium shadow-sm transition-colors ${
            selectMode
              ? "border-[var(--accent-deep)] bg-[var(--accent-deep)] text-white"
              : "border-[color:var(--input)] bg-transparent text-ink hover:bg-muted/40"
          }`}
        >
          <span
            aria-hidden
            className={`h-3 w-3 rounded-sm border ${
              selectMode ? "border-white bg-white/30" : "border-current"
            }`}
          />
          {selectMode ? "Selecting…" : "Select"}
        </button>
        {selectMode && (
          <span className="text-xs text-muted-foreground">
            Click shifts to select, then “Copy to”. Esc to clear.
          </span>
        )}
      </div>

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
              employees.map((e) => (
                <DraggableEmployee
                  key={e.id}
                  emp={e}
                  active={!!e.appUserId && activeEmployee === e.appUserId}
                  onSelect={
                    e.appUserId ? () => selectEmployee(e.appUserId!) : null
                  }
                />
              ))
            )}
          </ul>
        </aside>

        {/* Right: N-day area grid */}
        <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <div className="grid border-b border-border bg-muted/30" style={gridCols}>
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
                  {area.shiftsByDay.map((cell, idx) => {
                    const cellStart = addDays(weekStart, idx);
                    cellStart.setHours(0, 0, 0, 0);
                    const isPast =
                      todayStartMs != null &&
                      cellStart.getTime() < todayStartMs;
                    return (
                    <DayCell
                      key={idx}
                      areaKey={area.key}
                      dayIdx={idx}
                      dense={dense}
                      locationId={area.locationId}
                      role={area.role}
                      isPast={isPast}
                    >
                      {cell.map((s) => (
                        <ShiftChip
                          key={s.id}
                          shift={s}
                          dayIdx={idx}
                          nowMs={nowMs}
                          dense={dense}
                          selectMode={selectMode}
                          selected={selected.has(s.id)}
                          onCopy={handleCopy}
                          onToggleSelect={toggleSelect}
                        />
                      ))}
                    </DayCell>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectMode && selected.size > 0 && (
        <BulkCopyBar
          count={selected.size}
          weekStartMs={weekStartMs}
          areaOptions={areaOptions}
          open={menuOpen}
          setOpen={setMenuOpen}
          onCopy={runBulkCopy}
          onClear={clearSelection}
        />
      )}

      {flash && (
        <div
          className={`fixed bottom-24 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full border px-4 py-1.5 text-center text-sm font-medium shadow-lg ${
            flash.tone === "warn"
              ? "border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_15%,transparent)] text-[var(--warn)]"
              : "border-[color-mix(in_srgb,var(--live)_45%,transparent)] bg-[color-mix(in_srgb,var(--live)_12%,transparent)] text-[var(--live)]"
          }`}
        >
          {flash.text}
        </div>
      )}

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
