"use client";

import Link from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import {
  approveTimesheetAction,
  clearTimesheetApprovalAction,
  disputeTimesheetAction,
} from "./actions";
import type { AnomalyKind, RowDayDetail } from "./_row";

// Deputy-style timesheet detail panel. Right-aligned overlay rendered via
// portal so its <form> isn't nested inside the bulk-selection form on the
// page. Closes on Escape, on backdrop click, or after a successful action
// (the parent unmounts via panelOpen=false). Mobile widens to full-screen
// below the md breakpoint so the content stays readable on phones.

export interface ActivityEntry {
  id: string;
  action: string;
  actor: string;
  occurredAtIso: string;
  notes: string | null;
}

export interface TimesheetDetailPanelProps {
  open: boolean;
  onClose: () => void;
  // Identity + context
  userId: string;
  userName: string;
  userEmail: string;
  weekStartIso: string;
  weekLabel: string;
  // Approval state
  approvalStatus: "approved" | "disputed" | null;
  approvalNotes: string | null;
  approverName: string | null;
  approvedAtIso: string | null;
  // Totals
  totalWorkMs: number;
  totalBreakMs: number;
  hourlyRate: number | null;
  costAud: number | null;
  // Detail bodies
  perDayDetail: RowDayDetail[];
  anomalies: AnomalyKind[];
  activity: ActivityEntry[];
  // Permissions
  canManage: boolean;
}

const STATUS_BADGE: Record<"approved" | "disputed" | "pending", string> = {
  approved: "bg-[var(--live)] text-white",
  disputed: "bg-[var(--danger)] text-white",
  pending: "bg-[var(--ink-3)] text-white",
};

const ANOMALY_HINT: Record<AnomalyKind, string> = {
  overtime_week: "More than 40 hours worked this week.",
  long_shift: "At least one day with more than 10 hours.",
  no_clockout: "An open punch was auto-closed at week end — please review.",
  no_show: "Scheduled this week but never clocked in.",
};

const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  overtime_week: "Overtime",
  long_shift: "Long shift",
  no_clockout: "No clock-out",
  no_show: "No-show",
};

const ACTION_PRETTY: Record<string, string> = {
  "shiftcraft.timesheet.approved": "Approved",
  "shiftcraft.timesheet.disputed": "Disputed",
  "shiftcraft.timesheet.cleared": "Approval cleared",
};

function fmtHoursMs(ms: number): string {
  if (ms <= 0) return "0h 0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function fmtAud(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TimesheetDetailPanel(props: TimesheetDetailPanelProps) {
  // Escape closes the panel. Effect bound only while open so we don't pay
  // for listeners across the whole table.
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  if (typeof document === "undefined") return null;

  const status: "approved" | "disputed" | "pending" =
    props.approvalStatus ?? "pending";
  const statusLabel =
    status === "approved"
      ? "Approved"
      : status === "disputed"
        ? "Disputed"
        : "Pending";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Timesheet detail for ${props.userName}`}
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <aside className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-card shadow-2xl md:w-[32rem]">
        {/* ─── Header ─── */}
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Timesheet
              </div>
              <h2 className="mt-1 truncate text-lg font-semibold">
                {props.userName}
              </h2>
              <div className="truncate text-xs text-muted-foreground">
                {props.userEmail} · {props.weekLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              aria-label="Close panel"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status]}`}
            >
              {statusLabel}
            </span>
            {props.approverName && props.approvedAtIso ? (
              <span className="text-[11px] text-muted-foreground">
                {status === "approved" ? "Approved" : "Disputed"} by{" "}
                {props.approverName} · {fmtDateTime(props.approvedAtIso)}
              </span>
            ) : null}
          </div>
        </header>

        {/* ─── Scrollable body ─── */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Anomaly callout */}
          {props.anomalies.length > 0 ? (
            <section className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-3 py-2 text-xs text-[var(--warn)]">
              <div className="font-semibold uppercase tracking-wider text-[10px]">
                Anomalies
              </div>
              <ul className="mt-1 space-y-0.5">
                {props.anomalies.map((a) => (
                  <li key={a}>
                    <span className="font-medium">{ANOMALY_LABEL[a]}:</span>{" "}
                    {ANOMALY_HINT[a]}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Per-day section */}
          <section>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Per-day breakdown
            </div>
            {props.perDayDetail.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No clock activity this week.
              </p>
            ) : (
              <ul className="space-y-3 text-xs">
                {props.perDayDetail.map((d) => (
                  <li key={d.dayIso} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
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
                    </div>
                    {d.segments.length > 0 ? (
                      <ul className="ml-2 flex flex-wrap gap-1.5 pl-4">
                        {d.segments.map((s, i) => (
                          <li
                            key={i}
                            className={
                              s.kind === "work"
                                ? "inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--live)_12%,transparent)] px-2 py-1 font-mono tabular-nums text-[11px] text-[var(--live)]"
                                : "inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-2 py-1 font-mono tabular-nums text-[11px] text-[var(--warn)]"
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
                              {s.kind}
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
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Hours and pay (collapsible) */}
          <details className="rounded-md border border-border bg-background/50">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/40">
              Hours and pay
            </summary>
            <div className="space-y-1.5 border-t border-border px-3 py-3 text-xs">
              <Row label="Work hours" value={fmtHoursMs(props.totalWorkMs)} />
              <Row label="Break hours" value={fmtHoursMs(props.totalBreakMs)} />
              {props.hourlyRate != null ? (
                <>
                  <Row
                    label="Hourly rate"
                    value={`${fmtAud(props.hourlyRate)}/hr`}
                  />
                  <Row
                    label="Computed cost"
                    value={fmtAud(props.costAud)}
                    emphasis
                  />
                </>
              ) : (
                <p className="pt-1 text-xs text-muted-foreground">
                  No pay rate set —{" "}
                  <Link
                    href="/app/people/team"
                    className="underline hover:no-underline"
                  >
                    set it on their People profile →
                  </Link>
                </p>
              )}
            </div>
          </details>

          {/* Activity log */}
          {props.canManage ? (
            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Activity
              </div>
              {props.activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No approval activity yet for this week.
                </p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {props.activity.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-md border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {ACTION_PRETTY[a.action] ?? a.action}
                        </span>
                        <span className="text-muted-foreground">
                          · by {a.actor}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {fmtDateTime(a.occurredAtIso)}
                        </span>
                      </div>
                      {a.notes ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          "{a.notes}"
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {/* Manager note + Approve/Disapprove */}
          {props.canManage ? (
            <ApprovalControls
              userId={props.userId}
              weekStartIso={props.weekStartIso}
              currentStatus={props.approvalStatus}
              defaultNotes={props.approvalNotes ?? ""}
              onAfterAction={props.onClose}
            />
          ) : (
            <section className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Manager note
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {props.approvalNotes && props.approvalNotes.length > 0
                  ? props.approvalNotes
                  : "—"}
              </p>
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          emphasis ? "font-mono font-semibold tabular-nums" : "font-mono tabular-nums"
        }
      >
        {value}
      </span>
    </div>
  );
}

function ApprovalControls({
  userId,
  weekStartIso,
  currentStatus,
  defaultNotes,
  onAfterAction,
}: {
  userId: string;
  weekStartIso: string;
  currentStatus: "approved" | "disputed" | null;
  defaultNotes: string;
  onAfterAction: () => void;
}) {
  return (
    <section className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <div>
        <label
          htmlFor="panel-notes"
          className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Manager note
        </label>
        <textarea
          id="panel-notes"
          name="notes"
          form="panel-approve-form"
          rows={3}
          defaultValue={defaultNotes}
          placeholder="Optional context for this week's approval/dispute."
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Two forms, one shared textarea via form="panel-approve-form". The
          textarea posts with whichever button is clicked because both
          forms scope the same `notes` field by name. */}
      <form
        id="panel-approve-form"
        action={async (formData) => {
          await approveTimesheetAction(formData);
          onAfterAction();
        }}
        className="hidden"
      >
        <input type="hidden" name="employeeUserId" value={userId} />
        <input type="hidden" name="weekStart" value={weekStartIso} />
      </form>
      <form
        id="panel-dispute-form"
        action={async (formData) => {
          await disputeTimesheetAction(formData);
          onAfterAction();
        }}
        className="hidden"
      >
        <input type="hidden" name="employeeUserId" value={userId} />
        <input type="hidden" name="weekStart" value={weekStartIso} />
      </form>
      <form
        id="panel-clear-form"
        action={async (formData) => {
          await clearTimesheetApprovalAction(formData);
          onAfterAction();
        }}
        className="hidden"
      >
        <input type="hidden" name="employeeUserId" value={userId} />
        <input type="hidden" name="weekStart" value={weekStartIso} />
      </form>

      <div className="grid grid-cols-2 gap-2">
        <CtaButton
          form="panel-approve-form"
          tone="primary"
          disabled={currentStatus === "approved"}
          label="Approve"
          pendingLabel="Approving…"
          shareNotesFrom="panel-notes"
        />
        <CtaButton
          form="panel-dispute-form"
          tone="destructive"
          disabled={currentStatus === "disputed"}
          label="Disapprove"
          pendingLabel="Updating…"
          shareNotesFrom="panel-notes"
        />
      </div>
      {currentStatus != null ? (
        <CtaButton
          form="panel-clear-form"
          tone="ghost"
          label="Reset to pending"
          pendingLabel="Resetting…"
          shareNotesFrom={null}
        />
      ) : null}
    </section>
  );
}

// `<button form="...">` posts the named form. We also copy the shared
// textarea's value into that form just before submit so a single textarea
// can feed either approve or dispute.
function CtaButton({
  form,
  tone,
  disabled,
  label,
  pendingLabel,
  shareNotesFrom,
}: {
  form: string;
  tone: "primary" | "destructive" | "ghost";
  disabled?: boolean;
  label: string;
  pendingLabel: string;
  shareNotesFrom: string | null;
}) {
  const { pending } = useFormStatus();
  const cls =
    tone === "primary"
      ? "rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      : tone === "destructive"
        ? "rounded-md bg-[var(--danger)] px-3 py-2 text-sm font-semibold text-white hover:bg-[color-mix(in_srgb,var(--danger)_85%,black)] disabled:opacity-50"
        : "rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";
  return (
    <button
      type="submit"
      form={form}
      disabled={disabled || pending}
      onClick={(e) => {
        if (!shareNotesFrom) return;
        const textarea = document.getElementById(
          shareNotesFrom,
        ) as HTMLTextAreaElement | null;
        const targetForm = document.getElementById(
          form,
        ) as HTMLFormElement | null;
        if (!textarea || !targetForm) return;
        // Inject the current textarea value into the form so the action
        // receives `notes` even though the textarea lives outside it.
        let hidden = targetForm.querySelector<HTMLInputElement>(
          'input[name="notes"]',
        );
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden";
          hidden.name = "notes";
          targetForm.appendChild(hidden);
        }
        hidden.value = textarea.value;
        // Stop accidental double-submit (the button's default action
        // already submits the named form).
        e.stopPropagation();
      }}
      className={cls}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
