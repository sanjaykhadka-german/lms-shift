"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  addClockEventAction,
  editClockEventAction,
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
}

export type ModalContext = ModalEditContext | ModalAddContext;

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <header className="mb-4">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {ctx.mode === "edit" ? "Edit punch" : "Add punch"}
          </div>
          <h2 className="mt-1 text-lg font-semibold">
            {ctx.mode === "edit"
              ? `${ctx.userName} — ${ctx.eventTypeLabel}`
              : `${ctx.userName}`}
          </h2>
        </header>

        {ctx.mode === "edit" ? (
          <EditForm ctx={ctx} onClose={onClose} />
        ) : (
          <AddForm ctx={ctx} onClose={onClose} />
        )}
      </div>
    </div>
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
        <VoidButton originalEventId={ctx.originalEventId} onDone={onClose} />
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
          defaultValue="in"
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

function VoidButton({
  originalEventId,
  onDone,
}: {
  originalEventId: string;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-red-600/40 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Void
      </button>
    );
  }
  return (
    <form
      action={async (formData) => {
        formData.set("eventId", originalEventId);
        // Inherit the reason field from the parent form by reading it
        // here at submit time; if blank, fall back to a default.
        const reasonFromForm =
          (
            document.querySelector(
              'form textarea[name="reason"]',
            ) as HTMLTextAreaElement | null
          )?.value?.trim() ?? "";
        formData.set(
          "reason",
          reasonFromForm.length > 0 ? reasonFromForm : "Voided by manager",
        );
        await voidClockEventAction(formData);
        onDone();
      }}
    >
      <button
        type="submit"
        className="w-full rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Confirm void
      </button>
    </form>
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
