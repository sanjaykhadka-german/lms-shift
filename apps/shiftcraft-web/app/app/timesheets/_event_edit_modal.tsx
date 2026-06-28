"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFormStatus } from "react-dom";
import { TimeField12h } from "~/components/ui/time-field-12h";
import {
  addClockEventAction,
  editClockEventAction,
  editDayEntryAction,
  voidClockEventAction,
} from "./event-actions";

// Two-mode modal (edit | add) for an individual clock event. Server
// actions live in event-actions.ts — this component renders the form +
// closes itself on submit. State lives in the parent (TimesheetRow) so a
// row knows which segment is being edited.

export interface ModalEditContext {
  mode: "edit";
  originalEventId: string;
  /** Pre-fills datetime-local. Already in the local timezone. */
  occurredAtIso: string;
  /** Read-only label like 'Clocked in' / 'Started break' / etc. */
  eventTypeLabel: string;
  /** "Sanjay Khadka" — appears in the header. */
  userName: string;
}

export interface ModalAddContext {
  mode: "add";
  appUserId: string;
  userName: string;
  /** ISO string like 2026-05-23 used to pre-fill the date portion. */
  dateIso: string;
  /** Pre-selects the punch-type dropdown — e.g. opening straight to "out"
   *  from a "No clock-out" anomaly, or "in" from a "No-show". Defaults to
   *  "in" when unset. */
  defaultEventType?: "in" | "out" | "break_start" | "break_end";
}

// Day-entry mode: enter or edit a whole shift (clock in → any number of breaks
// → clock out) for one employee on one day in a single popup. With no prefill
// it adds a fresh day; with prefill (opened from a worked day's edit pencil) it
// shows the current punches and Save REPLACES that day's punches. Submits via
// editDayEntryAction.
export interface ModalDayEntryContext {
  mode: "dayEntry";
  appUserId: string;
  userName: string;
  /** YYYY-MM-DD — the day being added/edited. */
  dateIso: string;
  /** Prefill (HH:MM) when editing an existing day; omitted when adding fresh. */
  clockIn?: string;
  clockOut?: string;
  breaks?: Array<{ start: string; end: string }>;
}

export type ModalContext =
  | ModalEditContext
  | ModalAddContext
  | ModalDayEntryContext;

interface Props {
  ctx: ModalContext | null;
  onClose: () => void;
}

// Convert an ISO 8601 timestamp into the `YYYY-MM-DDTHH:mm` shape that
// <input type="datetime-local"> expects. Uses the browser's local time
// (no UTC conversion) so what the manager sees matches the timesheet
// display.
function toLocalDateTimeValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventEditModal({ ctx, onClose }: Props) {
  // Close on Escape.
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, onClose]);

  if (!ctx) return null;
  // Portal the dialog out to document.body so its <form> isn't nested
  // inside the table's BulkSelectionForm. Nested forms aren't valid
  // HTML and React 19 catches the resulting submit collision ('A React
  // form was unexpectedly submitted'). Server actions render the same
  // way through a portal — no behavioral change other than placement.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full rounded-xl border border-border bg-card p-6 shadow-2xl ${
          ctx.mode === "dayEntry" ? "max-w-lg" : "max-w-md"
        }`}
      >
        <header className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {ctx.mode === "edit"
              ? "Edit punch"
              : ctx.mode === "dayEntry"
                ? ctx.clockIn
                  ? "Edit entry"
                  : "Add entry"
                : "Add punch"}
          </div>
          <h2 className="mt-1 text-lg font-semibold">
            {ctx.mode === "edit"
              ? `${ctx.userName} — ${ctx.eventTypeLabel}`
              : `${ctx.userName}`}
          </h2>
        </header>

        {ctx.mode === "edit" ? (
          <EditForm ctx={ctx} onClose={onClose} />
        ) : ctx.mode === "dayEntry" ? (
          <DayEntryForm ctx={ctx} onClose={onClose} />
        ) : (
          <AddForm ctx={ctx} onClose={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function EditForm({
  ctx,
  onClose,
}: {
  ctx: ModalEditContext;
  onClose: () => void;
}) {
  const defaultLocal = toLocalDateTimeValue(ctx.occurredAtIso);
  return (
    <form
      action={async (formData) => {
        // The datetime-local input gives us a string like "2026-05-23T08:30"
        // with NO timezone — the action interprets it in the server's local
        // timezone, which matches what the user sees on screen.
        await editClockEventAction(formData);
        onClose();
      }}
      className="space-y-4"
    >
      <input
        type="hidden"
        name="originalEventId"
        value={ctx.originalEventId}
      />
      {/* Same id under the name voidClockEventAction's zod schema expects.
          Two names, one value — saves having a nested form for the void
          button (nested forms throw 'unexpectedly submitted' in React 19). */}
      <input type="hidden" name="eventId" value={ctx.originalEventId} />
      <Field label="Time">
        <input
          type="datetime-local"
          name="occurredAt"
          defaultValue={defaultLocal}
          required
          step={60}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>
      <Field label="Reason">
        <textarea
          name="reason"
          required
          maxLength={200}
          rows={2}
          placeholder="e.g. corrected — actual finish was 5:30pm"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <VoidButton onDone={onClose} />
        <SubmitButton label="Save" pendingLabel="Saving…" />
      </div>
    </form>
  );
}

function AddForm({
  ctx,
  onClose,
}: {
  ctx: ModalAddContext;
  onClose: () => void;
}) {
  // Pre-fill the date with the day the user invoked the modal from,
  // with the time blank so the manager has to enter it. step=60 forces
  // minute-precision (seconds aren't meaningful for clock punches).
  const defaultDate = `${ctx.dateIso}T09:00`;
  return (
    <form
      action={async (formData) => {
        await addClockEventAction(formData);
        onClose();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="appUserId" value={ctx.appUserId} />
      <Field label="Punch type">
        <select
          name="eventType"
          defaultValue={ctx.defaultEventType ?? "in"}
          required
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="in">Clock in</option>
          <option value="out">Clock out</option>
          <option value="break_start">Start break</option>
          <option value="break_end">End break</option>
        </select>
      </Field>
      <Field label="Time">
        <input
          type="datetime-local"
          name="occurredAt"
          defaultValue={defaultDate}
          required
          step={60}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>
      <Field label="Reason">
        <textarea
          name="reason"
          required
          maxLength={200}
          rows={2}
          placeholder="e.g. forgot to clock out — confirmed via roster"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <SubmitButton label="Add punch" pendingLabel="Adding…" />
      </div>
    </form>
  );
}

// Single-button void confirmation flow — no nested <form>. The button
// lives inside the parent EditForm and overrides the action via
// formAction= on submit. The parent's hidden `eventId` + the shared
// `reason` textarea satisfy voidClockEventAction's schema.
function VoidButton({ onDone }: { onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] px-3 py-2 text-sm font-medium text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]"
      >
        Void
      </button>
    );
  }
  return (
    <button
      type="submit"
      formAction={async (formData) => {
        // Fallback reason: voiding without a typed reason should still
        // record an audit trail message, not fail server validation.
        const reasonRaw = String(formData.get("reason") ?? "").trim();
        if (!reasonRaw) formData.set("reason", "Voided by manager");
        await voidClockEventAction(formData);
        onDone();
      }}
      className="w-full rounded-md bg-[var(--danger)] px-3 py-2 text-sm font-semibold text-white hover:bg-[color-mix(in_srgb,var(--danger)_85%,black)]"
    >
      Confirm void
    </button>
  );
}

// Whole-shift add/edit: clock in, 0..N breaks, clock out — one popup. Employee
// + date are fixed from the row/day it was opened on. Prefilled when editing an
// existing worked day; Save REPLACES that day's punches via editDayEntryAction
// (which reads the parallel breakStart[]/breakEnd[] inputs). Portaled to
// <body>, so a real <form> is fine here.
interface BreakRow {
  id: number;
  start: string;
  end: string;
}

function DayEntryForm({
  ctx,
  onClose,
}: {
  ctx: ModalDayEntryContext;
  onClose: () => void;
}) {
  const isEditing = !!ctx.clockIn;
  const nextBreakId = useRef(1);
  const [error, setError] = useState<string | null>(null);
  const [breakRows, setBreakRows] = useState<BreakRow[]>(
    (ctx.breaks ?? []).map((b) => ({
      id: nextBreakId.current++,
      start: b.start,
      end: b.end,
    })),
  );
  const addBreak = () =>
    setBreakRows((rows) => [
      ...rows,
      { id: nextBreakId.current++, start: "", end: "" },
    ]);
  const removeBreak = (id: number) =>
    setBreakRows((rows) => rows.filter((r) => r.id !== id));
  const updateBreak = (id: number, patch: Partial<BreakRow>) =>
    setBreakRows((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  return (
    <form
      action={async (formData) => {
        const res = await editDayEntryAction(formData);
        if (!res.ok) {
          // Surface the reason and keep the modal open with the entered values
          // (e.g. a break that runs past the finish) — was a silent no-op.
          setError(res.error);
          return;
        }
        onClose();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="appUserId" value={ctx.appUserId} />
      <input type="hidden" name="date" value={ctx.dateIso} />
      {isEditing ? (
        <p className="rounded-md border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2 text-[11px] text-ink">
          Saving replaces this day's punches with the values below (recorded as a
          manual edit).
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <EntryTimeField
            name="clockIn"
            dateIso={ctx.dateIso}
            required
            defaultValue={ctx.clockIn ?? ""}
          />
        </Field>
        <Field label="Finish">
          <EntryTimeField
            name="clockOut"
            dateIso={ctx.dateIso}
            required
            defaultValue={ctx.clockOut ?? ""}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Breaks
          </span>
          <button
            type="button"
            onClick={addBreak}
            className="text-xs font-medium text-primary hover:underline"
          >
            + Add break
          </button>
        </div>
        {breakRows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            No break. Add one or more if the shift had them.
          </p>
        ) : (
          breakRows.map((b, idx) => (
            <div
              key={b.id}
              className="space-y-2 rounded-md border border-border/60 p-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {idx === 0 ? "Break" : `Break ${idx + 1}`}
                </span>
                <button
                  type="button"
                  onClick={() => removeBreak(b.id)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-[var(--danger)]"
                >
                  ✕ Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start">
                  <EntryTimeField
                    name="breakStart"
                    dateIso={ctx.dateIso}
                    required
                    value={b.start}
                    onChange={(v) => updateBreak(b.id, { start: v })}
                  />
                </Field>
                <Field label="End">
                  <EntryTimeField
                    name="breakEnd"
                    dateIso={ctx.dateIso}
                    required
                    value={b.end}
                    onChange={(v) => updateBreak(b.id, { end: v })}
                  />
                </Field>
              </div>
            </div>
          ))
        )}
      </div>

      <Field label="Reason">
        <textarea
          name="reason"
          required
          maxLength={200}
          rows={2}
          placeholder="e.g. corrected — actual break was 30m"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </Field>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[color-mix(in_srgb,var(--destructive)_40%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-3 py-2 text-[11px] text-[color:var(--destructive)]"
        >
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <SubmitButton
          label={isEditing ? "Save entry" : "Add entry"}
          pendingLabel="Saving…"
        />
      </div>
    </form>
  );
}

// Time field for the whole-day entry form. Renders a 12-hour (AM/PM) picker
// and submits just the "HH:MM" (24h) the server action parses, via a hidden
// input. Works both uncontrolled (name + defaultValue, for Start/Finish) and
// controlled (value + onChange, for break rows). `dateIso` is accepted for
// call-site symmetry but no longer used (the picker is pure time-of-day).
function EntryTimeField({
  name,
  value,
  defaultValue,
  onChange,
  required,
}: {
  name: string;
  dateIso: string;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
  required?: boolean;
}) {
  return (
    <TimeField12h
      name={name}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      required={required}
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
