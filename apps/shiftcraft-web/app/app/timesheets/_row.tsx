"use client";

import { useState, type ReactNode } from "react";
import {
  EventEditModal,
  type ModalContext,
} from "./_event_edit_modal";

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

export interface RowProps {
  userId: string;
  name: string;
  email: string;
  deptLabel: string | null;
  /** Per-day actual hours, formatted ("8:00" or "—"). Mon..Sun, length 7. */
  perDayActualDisplay: string[];
  /** Per-day planned hours, formatted ("8h" or "" when none). Length 7. */
  perDayPlannedDisplay: string[];
  totalWorkDisplay: string;
  totalBreakDisplay: string;
  costDisplay: string;
  perDayDetail: RowDayDetail[];
  totalColumnCount: number;
  approvalCell: ReactNode;
  isAdmin: boolean;
  showCost: boolean;
  showCheckbox: boolean;
  anomalies: AnomalyKind[];
}

const ANOMALY_LABEL: Record<AnomalyKind, { label: string; classes: string }> = {
  overtime_week: {
    label: "Overtime",
    classes: "bg-amber-500 text-white",
  },
  long_shift: {
    label: "Long shift",
    classes: "bg-amber-500 text-white",
  },
  no_clockout: {
    label: "No clock-out",
    classes: "bg-rose-600 text-white",
  },
  no_show: {
    label: "No-show",
    classes: "bg-red-600 text-white",
  },
};

export function TimesheetRow({
  userId,
  name,
  email,
  deptLabel,
  perDayActualDisplay,
  perDayPlannedDisplay,
  totalWorkDisplay,
  totalBreakDisplay,
  costDisplay,
  perDayDetail,
  totalColumnCount,
  approvalCell,
  isAdmin,
  showCost,
  showCheckbox,
  anomalies,
}: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [modalCtx, setModalCtx] = useState<ModalContext | null>(null);
  const canExpand = perDayDetail.length > 0;

  return (
    <>
      <tr>
        {showCheckbox ? (
          <td className="px-2 py-2 align-middle">
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
        <td className="px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{name}</span>
            {isAdmin && anomalies.length > 0
              ? anomalies.map((a) => (
                  <span
                    key={a}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ANOMALY_LABEL[a].classes}`}
                    title={anomalyHint(a)}
                  >
                    {ANOMALY_LABEL[a].label}
                  </span>
                ))
              : null}
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
          const planned = perDayPlannedDisplay[i] ?? "";
          return (
            <td
              key={i}
              className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
            >
              <div>{actual}</div>
              {planned ? (
                <div className="text-[10px] text-muted-foreground/60">
                  /{planned}
                </div>
              ) : null}
            </td>
          );
        })}
        <td className="px-3 py-2 font-mono text-sm tabular-nums font-semibold">
          {totalWorkDisplay}
        </td>
        <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
          {totalBreakDisplay}
        </td>
        {showCost ? (
          <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
            {costDisplay}
          </td>
        ) : null}
        <td className="px-3 py-2 align-top">{approvalCell}</td>
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
                            ? "font-medium text-amber-600"
                            : d.deltaTone === "emerald"
                              ? "font-medium text-emerald-600"
                              : "text-muted-foreground"
                        }
                      >
                        · {d.deltaLabel}
                      </span>
                    ) : null}
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() =>
                          setModalCtx({
                            mode: "add",
                            appUserId: userId,
                            userName: name,
                            dateIso: d.dayIso,
                          })
                        }
                        className="ml-auto rounded-md border border-dashed border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        + Add punch
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
                              ? "inline-flex items-center gap-1.5 rounded-md bg-emerald-600/10 px-2 py-1 font-mono tabular-nums text-emerald-700 dark:text-emerald-400"
                              : "inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 font-mono tabular-nums text-amber-700 dark:text-amber-400"
                          }
                        >
                          {s.selfieEventId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/kiosk-selfie/${s.selfieEventId}`}
                              alt=""
                              width={32}
                              height={24}
                              className="h-6 w-8 rounded-sm border border-border object-cover"
                            />
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
                          {isAdmin ? (
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
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
      <EventEditModal ctx={modalCtx} onClose={() => setModalCtx(null)} />
    </>
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
