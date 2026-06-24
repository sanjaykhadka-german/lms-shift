"use client";

import {
  useState,
  useTransition,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  approveDayAction,
  clearDayApprovalAction,
  disputeDayAction,
} from "./actions";
import {
  EventEditModal,
  type ModalContext,
} from "./_event_edit_modal";
import {
  TimesheetDetailPanel,
  type ActivityEntry,
} from "./_detail_panel";
import { editBreakInlineAction } from "./event-actions";
import { SelfieThumb } from "~/components/SelfieThumb";

// datetime-local value (YYYY-MM-DDTHH:mm) in the browser's local tz from an ISO
// string — mirrors the helper in _event_edit_modal so what's shown matches the
// timesheet display (no UTC shift).
function toLocalDateTimeValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// HH:MM (local) from an ISO string — prefills the whole-day editor's time
// inputs from the day's existing punches.
function isoToTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Per-day expansion row + anomaly chips + scheduled-vs-actual subscripts +
// per-segment audit detail (source / location / selfie thumbnail) + inline
// edit / add / void via the modal mounted at the row level.
//
// Server pre-formats every display string so this client component stays
// free of server-only imports + date math.

export interface RowSegmentDisplay {
  kind: "work" | "break";
  /** Pre-formatted "07:30–12:00 (4h 30m)". */
  label: string;
  /** "Kiosk" / "Manual" / "Admin edit" / "Geofence". */
  sourceLabel: string;
  /** sc_locations.name when the opening event carried a location. */
  locationName: string | null;
  /** When non-null, /api/kiosk-selfie/<id> serves a 32×24 thumbnail of
   *  the selfie captured at this opening event. */
  selfieEventId: string | null;
  /** The scClockEvents.id that opened this segment. */
  openingEventId: string;
  /** ISO 8601 of the opening event's occurredAt — pre-fills the edit
   *  modal's datetime-local input. */
  openingOccurredAtIso: string;
  /** Human label for the opening event ('Clock-in' / 'Clock-out' /
   *  'Break start' / 'Break end'). Read-only in the edit modal. */
  openingEventTypeLabel: string;
  /** Break segments only: the break_end event id + its ISO time, so a break's
   *  start AND end can be edited together inline (item 5). Null otherwise. */
  closingEventId?: string | null;
  closingOccurredAtIso?: string | null;
}

export interface RowDayDetail {
  /** "Mon 19 May". */
  dayLabel: string;
  /** YYYY-MM-DD — used by the "Add punch" modal to pre-fill the date
   *  portion of the datetime-local input. */
  dayIso: string;
  /** "Planned 8h" or null when nothing scheduled. */
  plannedLabel: string | null;
  /** "Actual 7h 30m". */
  actualLabel: string;
  /** "Δ -30m" / "Δ +1h" / null when no planned shift. */
  deltaLabel: string | null;
  deltaTone: "neutral" | "amber" | "emerald" | null;
  segments: RowSegmentDisplay[];
}

export type AnomalyKind =
  | "overtime_week"
  | "long_shift"
  | "no_clockout"
  | "no_show";

// A one-click correction target for an actionable anomaly: opens the Add Punch
// modal on the given day, pre-set to the punch type that fixes it (a missing
// clock-out for "no_clockout", a clock-in for "no_show"). Only the fixable
// kinds get an entry; "overtime_week"/"long_shift" are informational.
export interface AnomalyFix {
  kind: Extract<AnomalyKind, "no_clockout" | "no_show">;
  dayIso: string;
  eventType: "in" | "out";
}

export interface RowProps {
  userId: string;
  name: string;
  email: string;
  deptLabel: string | null;
  /** Per-day actual hours, formatted ("8:00" or "—"). Mon..Sun, length 7. */
  perDayActualDisplay: string[];
  /** Per-day actual worked ms, Mon..Sun, length 7. Drives the heat tint. */
  perDayActualMs: number[];
  /** Per-day display/gating metadata, Mon..Sun, length 7. Drives greying of
   *  future days, the in-progress pill, per-day no-show tinting, and the
   *  per-day approve control + status tint on completed days. */
  perDayMeta: Array<{
    dayIso: string;
    isFuture: boolean;
    isInProgress: boolean;
    isComplete: boolean;
    noShow: boolean;
    approval: "approved" | "disputed" | null;
  }>;
  /** CSV of this employee-week's completed (approvable) day ISO dates —
   *  passed to the per-day approval actions so the week rollup knows the
   *  denominator without re-aggregating the clock stream. */
  completedDaysCsv: string;
  totalWorkDisplay: string;
  totalBreakDisplay: string;
  costDisplay: string;
  perDayDetail: RowDayDetail[];
  totalColumnCount: number;
  approvalCell: ReactNode;
  isAdmin: boolean;
  canManage: boolean;
  showCost: boolean;
  showCheckbox: boolean;
  anomalies: AnomalyKind[];
  /** Correction targets for the actionable anomalies in `anomalies` (a
   *  missing clock-out / no-show). Empty when the week is approved or no fix
   *  applies. Drives the clickable anomaly chips. */
  anomalyFixes: AnomalyFix[];
  // Detail-panel payload — passed through verbatim. The panel renders
  // lazily (only when the user clicks Details) so this only allocates
  // when needed.
  weekStartIso: string;
  weekLabel: string;
  approvalStatus: "approved" | "disputed" | null;
  approvalNotes: string | null;
  approverName: string | null;
  approvedAtIso: string | null;
  totalWorkMs: number;
  totalBreakMs: number;
  hourlyRate: number | null;
  costAud: number | null;
  activity: ActivityEntry[];
  /** AUDIT.md Phase 2 #3b.3 — pre-formatted breakdown line for the row.
   *  E.g. "28h ord · 2h OT 1.5× · 1h OT 2×". Null when the row has no
   *  worked minutes (the dash in the actual cell already covers that). */
  awardBreakdownDisplay: string | null;
  /** Number of public-holiday days in this week per the tenant's
   *  configured region. Drives a single chip. */
  publicHolidayCount: number;
  /** AUDIT.md Phase 2 #3b.4 — pre-formatted award-derived cost string
   *  (e.g. "$345.20"). Same fmtAud output as costDisplay. */
  awardCostDisplay: string;
  /** True when the award cost equals the flat cost (or there's no work)
   *  — the row hides the second line in that case to reduce visual
   *  noise on simple weeks. */
  awardCostMatchesFlat: boolean;
  /** Per-employee Xero export outcome for the displayed week. Null when
   *  the week hasn't been exported or this employee wasn't pushed (no
   *  link / no hours). `detail` carries the Xero validation error on a
   *  failed push. */
  xeroExport: { state: "exported" | "failed"; detail: string | null } | null;
}

// In-progress accent — a blue distinct from the green/amber/red status palette
// so a still-clocked-in day reads as "live, not yet final". Hardcoded (the
// theme has no blue token) and used via color-mix so it tints, not shouts.
const IN_PROGRESS_COLOR = "#2563eb";

// Per-day approve / dispute control shown on a completed day cell. Approving
// toggles back to pending on a second click; disputing opens a prompt for the
// reason. Calls the server actions imperatively (no inner <form>, which the
// bulk-selection <form> wrapper would reject as nested).
function DayApproveToggle({
  userId,
  workDate,
  completedDaysCsv,
  status,
}: {
  userId: string;
  workDate: string;
  completedDaysCsv: string;
  status: "approved" | "disputed" | null;
}) {
  const [pending, startTransition] = useTransition();
  const run = (
    action: (fd: FormData) => Promise<void>,
    extra?: Record<string, string>,
  ) => {
    const fd = new FormData();
    fd.append("employeeUserId", userId);
    fd.append("workDate", workDate);
    fd.append("completedDays", completedDaysCsv);
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    startTransition(async () => {
      await action(fd);
    });
  };
  const base =
    "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[9px] font-bold leading-none transition-colors disabled:opacity-50";
  if (status === "approved") {
    return (
      <button
        type="button"
        disabled={pending}
        title="Approved — click to clear"
        onClick={() => run(clearDayApprovalAction)}
        className={base}
        style={{
          borderColor: "var(--live)",
          background: "var(--live)",
          color: "#fff",
        }}
      >
        ✓
      </button>
    );
  }
  if (status === "disputed") {
    return (
      <button
        type="button"
        disabled={pending}
        title="Disputed — click to clear"
        onClick={() => run(clearDayApprovalAction)}
        className={base}
        style={{
          borderColor: "var(--warn)",
          background: "var(--warn)",
          color: "#fff",
        }}
      >
        !
      </button>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        disabled={pending}
        title="Approve this day"
        onClick={() => run(approveDayAction)}
        className={`${base} hover:bg-[var(--live)] hover:text-white`}
        style={{ borderColor: "var(--live)", color: "var(--live)" }}
      >
        ✓
      </button>
      <button
        type="button"
        disabled={pending}
        title="Dispute this day"
        onClick={() => {
          const reason = window.prompt(
            "Dispute this day?\n\nAdd a note for the employee (optional):",
            "",
          );
          if (reason == null) return;
          run(disputeDayAction, { notes: reason.trim() });
        }}
        className={`${base} hover:bg-[var(--warn)] hover:text-white`}
        style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
      >
        !
      </button>
    </div>
  );
}

// Informational anomalies (overtime / long shift) render quiet — they're
// context, not a call to action. The actionable ones (no clock-out / no-show)
// keep the danger treatment so the "· Fix" affordance stands out.
const ANOMALY_LABEL: Record<AnomalyKind, { label: string; classes: string }> = {
  overtime_week: {
    label: "Overtime",
    classes:
      "font-mono text-[9px] uppercase bg-[var(--paper-2)] text-ink-3 border border-[var(--line-soft)]",
  },
  long_shift: {
    label: "Long shift",
    classes:
      "font-mono text-[9px] uppercase bg-[var(--paper-2)] text-ink-3 border border-[var(--line-soft)]",
  },
  no_clockout: {
    label: "No clock-out",
    classes:
      "text-[10px] font-semibold uppercase tracking-wider bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]",
  },
  no_show: {
    label: "No-show",
    classes:
      "text-[10px] font-semibold uppercase tracking-wider bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-[var(--danger)]",
  },
};

export function TimesheetRow({
  userId,
  name,
  email,
  deptLabel,
  perDayActualDisplay,
  perDayActualMs,
  perDayMeta,
  completedDaysCsv,
  totalWorkDisplay,
  totalBreakDisplay,
  costDisplay,
  perDayDetail,
  totalColumnCount,
  approvalCell,
  isAdmin,
  canManage,
  showCost,
  showCheckbox,
  anomalies,
  anomalyFixes,
  weekStartIso,
  weekLabel,
  approvalStatus,
  approvalNotes,
  approverName,
  approvedAtIso,
  totalWorkMs,
  totalBreakMs,
  hourlyRate,
  costAud,
  activity,
  awardBreakdownDisplay,
  publicHolidayCount,
  awardCostDisplay,
  awardCostMatchesFlat,
  xeroExport,
}: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [modalCtx, setModalCtx] = useState<ModalContext | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Which break is being edited inline (item 5) — keyed by day so the editor
  // renders under that day's segment chips.
  const [editingBreak, setEditingBreak] = useState<{
    dayIso: string;
    segment: RowSegmentDisplay;
  } | null>(null);
  const canExpand = perDayDetail.length > 0;
  // AUDIT.md #4 — when the week is approved, hide every clock-event
  // mutation affordance. The Reopen button on the approval cell is the
  // sole path back to editable state.
  const isLocked = approvalStatus === "approved";

  return (
    <>
      <tr>
        {showCheckbox ? (
          <td className="px-2 py-[13px] align-middle">
            <input
              type="checkbox"
              name="userId"
              value={userId}
              aria-label={`Select ${name} for bulk action`}
              className="h-4 w-4 rounded border-border"
            />
          </td>
        ) : null}
        <td className="px-2 py-2 align-middle">
          {canExpand ? (
            <button
              type="button"
              aria-label={expanded ? "Collapse details" : "Expand details"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-xs text-muted-foreground hover:bg-muted"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="inline-block h-6 w-6" aria-hidden />
          )}
        </td>
        <td className="px-4 py-[13px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="text-sm font-medium hover:underline"
              aria-label={`Open timesheet details for ${name}`}
            >
              {name}
            </button>
            {isAdmin && anomalies.length > 0
              ? anomalies.map((a) => {
                  const fix = anomalyFixes.find((f) => f.kind === a);
                  // A fixable anomaly on an editable week becomes a button that
                  // opens the Add Punch modal on the right day, pre-set to the
                  // punch type that resolves it.
                  if (fix && !isLocked) {
                    return (
                      <button
                        key={a}
                        type="button"
                        onClick={() =>
                          setModalCtx({
                            mode: "add",
                            appUserId: userId,
                            userName: name,
                            dateIso: fix.dayIso,
                            defaultEventType: fix.eventType,
                          })
                        }
                        title={`${anomalyHint(a)} — click to add the missing punch`}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:opacity-90 ${ANOMALY_LABEL[a].classes}`}
                      >
                        {ANOMALY_LABEL[a].label}
                        <span
                          aria-hidden
                          className="font-normal normal-case opacity-80"
                        >
                          · Fix
                        </span>
                      </button>
                    );
                  }
                  return (
                    <span
                      key={a}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 ${ANOMALY_LABEL[a].classes}`}
                      title={anomalyHint(a)}
                    >
                      {ANOMALY_LABEL[a].label}
                    </span>
                  );
                })
              : null}
            {isAdmin && publicHolidayCount > 0 ? (
              <span
                className="inline-flex items-center rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
                title="Penalty rates likely apply for public-holiday hours. Cost computation pending — see classifier breakdown."
              >
                {publicHolidayCount === 1
                  ? "Public holiday"
                  : `${publicHolidayCount} public holidays`}
              </span>
            ) : null}
            {isAdmin && xeroExport ? (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white ${
                  xeroExport.state === "exported"
                    ? "bg-[var(--live)]"
                    : "bg-[var(--danger)]"
                }`}
                title={
                  xeroExport.state === "exported"
                    ? "Pushed to Xero for this week"
                    : (xeroExport.detail ?? "Xero rejected this timesheet")
                }
              >
                {xeroExport.state === "exported" ? "Xero ✓" : "Xero ✗"}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="ml-1 rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Details
            </button>
          </div>
          <div className="text-xs text-muted-foreground">
            {email}
            {isAdmin && deptLabel ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {deptLabel}
              </span>
            ) : null}
          </div>
        </td>
        {perDayActualDisplay.map((actual, i) => {
          const ms = perDayActualMs[i] ?? 0;
          const meta = perDayMeta[i] ?? {
            isFuture: false,
            isInProgress: false,
            isComplete: false,
            noShow: false,
          };

          // Future day: greyed + locked, no value — clearly "not yet". (#1)
          if (meta.isFuture) {
            return (
              <td key={i} className="px-3 py-[13px] align-middle">
                <div
                  className="flex min-h-[44px] flex-col items-center justify-center rounded-[9px] border border-dashed border-[var(--line-soft)] bg-[var(--paper-2)] px-[3px] py-2 text-center opacity-50"
                  title="Upcoming — this day hasn't happened yet"
                >
                  <span className="font-mono text-xs text-ink-3" aria-hidden>
                    ·
                  </span>
                </div>
              </td>
            );
          }

          // No-show: rostered but no punches on a day that has passed. (#3)
          if (meta.noShow) {
            return (
              <td key={i} className="px-3 py-[13px] align-middle">
                <div
                  className="flex min-h-[44px] flex-col items-center justify-center rounded-[9px] border px-[3px] py-2 text-center"
                  style={{
                    borderColor: "var(--danger)",
                    background:
                      "color-mix(in srgb, var(--danger) 12%, transparent)",
                  }}
                  title="Rostered but no clock-in recorded — no-show"
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--danger)]">
                    No show
                  </span>
                </div>
              </td>
            );
          }

          // In progress: still clocked in. Show live-so-far + a "Live" pill;
          // the approve affordance stays hidden until the shift completes. (#4)
          if (meta.isInProgress) {
            return (
              <td key={i} className="px-3 py-[13px] align-middle">
                <div
                  className="flex min-h-[44px] flex-col items-center justify-center rounded-[9px] border px-[3px] py-2 text-center"
                  style={{
                    borderColor: IN_PROGRESS_COLOR,
                    background: `color-mix(in srgb, ${IN_PROGRESS_COLOR} 12%, transparent)`,
                  }}
                  title="Clocked in — shift in progress (live so far)"
                >
                  <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                    {ms ? actual : "0:00"}
                  </span>
                  <span
                    className="text-[8px] font-semibold uppercase tracking-wider"
                    style={{ color: IN_PROGRESS_COLOR }}
                  >
                    ⏱ Live
                  </span>
                </div>
              </td>
            );
          }

          // Completed shift: tint by per-day approval (green approved / amber
          // disputed / heat when pending) and, for managers, show the per-day
          // approve/dispute toggle. (#2, #5)
          if (meta.isComplete) {
            const hours = ms / 3_600_000;
            const alpha = Math.min(hours / 24, 1) * 0.55;
            const approved = meta.approval === "approved";
            const disputed = meta.approval === "disputed";
            const tinted = approved || disputed;
            const accent = approved ? "var(--live)" : "var(--warn)";
            return (
              <td key={i} className="px-3 py-[13px] align-middle">
                <div
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-[9px] border px-[3px] py-1.5 text-center ${tinted ? "" : "heat-tile"}`}
                  style={
                    tinted
                      ? {
                          borderColor: accent,
                          background: `color-mix(in srgb, ${accent} 13%, transparent)`,
                        }
                      : ({
                          borderColor: "var(--line-soft)",
                          "--heat": alpha.toFixed(2),
                        } as CSSProperties)
                  }
                >
                  <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                    {actual}
                  </span>
                  {canManage ? (
                    <DayApproveToggle
                      userId={userId}
                      workDate={meta.dayIso}
                      completedDaysCsv={completedDaysCsv}
                      status={meta.approval}
                    />
                  ) : tinted ? (
                    <span
                      className="text-[8px] font-semibold uppercase tracking-wider"
                      style={{ color: accent }}
                    >
                      {approved ? "Approved" : "Disputed"}
                    </span>
                  ) : null}
                </div>
              </td>
            );
          }

          // Empty day (no activity, not future / no-show / in-progress) — a
          // plain dash tile.
          return (
            <td key={i} className="px-3 py-[13px] align-middle">
              <div className="flex min-h-[44px] flex-col items-center justify-center rounded-[9px] border border-[var(--line-soft)] px-[3px] py-2 text-center">
                <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                  <span className="text-ink-3">—</span>
                </span>
              </div>
            </td>
          );
        })}
        <td className="px-3 py-[13px] font-mono text-sm tabular-nums font-semibold">
          <div>{totalWorkDisplay}</div>
          {awardBreakdownDisplay ? (
            <div
              className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground/80"
              title="Ordinary / OT 1.5× / OT 2× per the default award thresholds (8h daily, 38h weekly). Cost computation pending."
            >
              {awardBreakdownDisplay}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
          {totalBreakDisplay}
        </td>
        {showCost ? (
          <td className="px-3 py-[13px] font-mono text-xs tabular-nums text-muted-foreground">
            <div>{costDisplay}</div>
            {!awardCostMatchesFlat ? (
              <div
                className="text-[10px] text-[var(--warn)]"
                title="Award-derived using OT × penalty multipliers under the default 'max' policy. Per-tenant policy override pending."
              >
                {awardCostDisplay} award
              </div>
            ) : null}
          </td>
        ) : null}
        <td className="px-3 py-[13px] align-top">{approvalCell}</td>
      </tr>
      {expanded && canExpand ? (
        <tr className="bg-muted/30">
          <td colSpan={totalColumnCount} className="px-6 py-3">
            <ul className="space-y-2 text-xs">
              {perDayDetail.map((d) => (
                <li key={d.dayIso} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-[5.5rem] font-medium text-foreground">
                      {d.dayLabel}
                    </span>
                    {d.plannedLabel ? (
                      <span className="text-muted-foreground">
                        {d.plannedLabel}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground">
                      · {d.actualLabel}
                    </span>
                    {d.deltaLabel ? (
                      <span
                        className={
                          d.deltaTone === "amber"
                            ? "font-medium text-[var(--warn)]"
                            : d.deltaTone === "emerald"
                              ? "font-medium text-[var(--live)]"
                              : "text-muted-foreground"
                        }
                      >
                        · {d.deltaLabel}
                      </span>
                    ) : null}
                    {isAdmin && !isLocked ? (
                      <button
                        type="button"
                        onClick={() =>
                          setModalCtx({
                            mode: "dayEntry",
                            appUserId: userId,
                            userName: name,
                            dateIso: d.dayIso,
                          })
                        }
                        className="ml-auto rounded-md border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        + Add entry
                      </button>
                    ) : null}
                  </div>
                  {d.segments.length > 0 ? (
                    <ul className="ml-2 flex flex-wrap gap-2 pl-4 text-[11px]">
                      {d.segments.map((s, i) => (
                        <li
                          key={i}
                          className={
                            s.kind === "work"
                              ? "inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--live)_12%,transparent)] px-2 py-1 font-mono tabular-nums text-[var(--live)]"
                              : "inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-2 py-1 font-mono tabular-nums text-[var(--warn)]"
                          }
                        >
                          {s.selfieEventId ? (
                            <SelfieThumb eventId={s.selfieEventId} />
                          ) : null}
                          <span className="text-[9px] uppercase tracking-wider opacity-70">
                            {s.kind === "work" ? "work" : "break"}
                          </span>
                          <span>{s.label}</span>
                          <span className="inline-flex items-center rounded-full bg-card px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground ring-1 ring-border">
                            {s.sourceLabel}
                          </span>
                          {s.locationName ? (
                            <span className="text-[9px] text-muted-foreground/80">
                              · {s.locationName}
                            </span>
                          ) : null}
                          {isAdmin && !isLocked ? (
                            s.kind === "break" && s.closingEventId ? (
                              // Break: edit start + end together, inline.
                              <button
                                type="button"
                                aria-label="Edit this break"
                                onClick={() =>
                                  setEditingBreak({ dayIso: d.dayIso, segment: s })
                                }
                                className="ml-1 rounded p-0.5 text-current/70 hover:bg-foreground/10"
                              >
                                ✎
                              </button>
                            ) : s.kind === "work" ? (
                              // Work: edit the WHOLE day (clock in + breaks +
                              // clock out) in one popup, prefilled from the day's
                              // current punches.
                              <button
                                type="button"
                                aria-label="Edit this day's shift"
                                onClick={() => {
                                  const workSegs = d.segments.filter(
                                    (x) => x.kind === "work",
                                  );
                                  const breakSegs = d.segments.filter(
                                    (x) => x.kind === "break",
                                  );
                                  const inIso = workSegs[0]?.openingOccurredAtIso;
                                  const outIso =
                                    workSegs[workSegs.length - 1]
                                      ?.closingOccurredAtIso ?? null;
                                  setModalCtx({
                                    mode: "dayEntry",
                                    appUserId: userId,
                                    userName: name,
                                    dateIso: d.dayIso,
                                    clockIn: inIso ? isoToTime(inIso) : undefined,
                                    clockOut: outIso
                                      ? isoToTime(outIso)
                                      : undefined,
                                    breaks: breakSegs
                                      .filter((bk) => bk.closingOccurredAtIso)
                                      .map((bk) => ({
                                        start: isoToTime(bk.openingOccurredAtIso),
                                        end: isoToTime(bk.closingOccurredAtIso!),
                                      })),
                                  });
                                }}
                                className="ml-1 rounded p-0.5 text-current/70 hover:bg-foreground/10"
                              >
                                ✎
                              </button>
                            ) : (
                              <button
                                type="button"
                                aria-label="Edit this punch"
                                onClick={() =>
                                  setModalCtx({
                                    mode: "edit",
                                    originalEventId: s.openingEventId,
                                    occurredAtIso: s.openingOccurredAtIso,
                                    eventTypeLabel: s.openingEventTypeLabel,
                                    userName: name,
                                  })
                                }
                                className="ml-1 rounded p-0.5 text-current/70 hover:bg-foreground/10"
                              >
                                ✎
                              </button>
                            )
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {editingBreak && editingBreak.dayIso === d.dayIso ? (
                    <BreakInlineEditor
                      segment={editingBreak.segment}
                      onClose={() => setEditingBreak(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
      <EventEditModal ctx={modalCtx} onClose={() => setModalCtx(null)} />
      <TimesheetDetailPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        userId={userId}
        userName={name}
        userEmail={email}
        weekStartIso={weekStartIso}
        weekLabel={weekLabel}
        approvalStatus={approvalStatus}
        approvalNotes={approvalNotes}
        approverName={approverName}
        approvedAtIso={approvedAtIso}
        totalWorkMs={totalWorkMs}
        totalBreakMs={totalBreakMs}
        hourlyRate={hourlyRate}
        costAud={costAud}
        perDayDetail={perDayDetail}
        anomalies={anomalies}
        activity={activity}
        canManage={canManage}
      />
    </>
  );
}

// Inline break editor (item 5). Edits a break's start AND end in place. The
// timesheet table is wrapped in the bulk-selection <form>, so this deliberately
// uses NO <form> element — Save calls the server action directly to avoid an
// invalid nested form. The action revalidates /app/timesheets, so the change
// flows back in once it closes.
function BreakInlineEditor({
  segment,
  onClose,
}: {
  segment: RowSegmentDisplay;
  onClose: () => void;
}) {
  const [start, setStart] = useState(
    toLocalDateTimeValue(segment.openingOccurredAtIso),
  );
  const [end, setEnd] = useState(
    segment.closingOccurredAtIso
      ? toLocalDateTimeValue(segment.closingOccurredAtIso)
      : "",
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls =
    "h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary";

  async function save() {
    if (!segment.closingEventId || saving) return;
    setSaving(true);
    const fd = new FormData();
    fd.set("startEventId", segment.openingEventId);
    fd.set("endEventId", segment.closingEventId);
    fd.set("startOccurredAt", start);
    fd.set("endOccurredAt", end);
    fd.set("reason", reason.trim() || "Break edited inline");
    await editBreakInlineAction(fd);
    setSaving(false);
    onClose();
  }

  return (
    <div className="ml-6 mt-1 flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-2">
      <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Break start
        <input
          type="datetime-local"
          step={60}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Break end
        <input
          type="datetime-local"
          step={60}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="flex flex-1 flex-col gap-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Reason
        <input
          type="text"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. break was 30m not 60m"
          className={`${inputCls} min-w-[8rem]`}
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onClose}
        disabled={saving}
        className="h-8 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}

function anomalyHint(a: AnomalyKind): string {
  switch (a) {
    case "overtime_week":
      return "More than 40 hours worked this week.";
    case "long_shift":
      return "At least one day with more than 10 hours.";
    case "no_clockout":
      return "An open punch was auto-closed at week end — please review.";
    case "no_show":
      return "Scheduled this week but never clocked in.";
  }
}
