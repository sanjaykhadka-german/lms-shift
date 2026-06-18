"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ShiftBreak } from "@tracey/db";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createShiftAction,
  publishShiftAction,
  updateShiftAction,
  type FormState,
} from "./actions";

interface BreakRow {
  id: number;
  label: string;
  minutes: string;
  paid: boolean;
}

const initial: FormState = { status: "idle" };

export interface ShiftTemplateSummary {
  id: string;
  name: string;
  locationId: string;
  role: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  defaultNotes: string | null;
  defaultBreaks: ShiftBreak[];
  requiredSkillId: string | null;
}

interface Props {
  mode: "create" | "edit";
  shiftId?: string;
  /** True when the shift has already started — the start time is locked
   *  (read-only) and can't be retimed. Other fields stay editable. */
  startLocked?: boolean;
  locations: Array<{ id: string; name: string }>;
  /** Skills catalogue for the optional required-skill dropdown. */
  skills?: Array<{ id: string; name: string }>;
  /** Saved templates managers can stamp onto a date. Only shown on create. */
  templates?: ShiftTemplateSummary[];
  defaultValues?: {
    locationId: string;
    role: string;
    startsAt: string; // datetime-local format: YYYY-MM-DDTHH:mm
    endsAt: string;
    notes: string | null;
    breaks?: ShiftBreak[];
    requiredSkillId?: string | null;
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Extracts the YYYY-MM-DD portion of a `datetime-local` value, falling back to today. */
function dateOnly(dt: string): string {
  if (dt && /^\d{4}-\d{2}-\d{2}/.test(dt)) return dt.slice(0, 10);
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function ShiftForm({
  mode,
  shiftId,
  startLocked = false,
  locations,
  skills = [],
  templates = [],
  defaultValues,
}: Props) {
  const action =
    mode === "edit" && shiftId
      ? updateShiftAction.bind(null, shiftId)
      : createShiftAction;
  const [state, formAction, pending] = useActionState(action, initial);

  // After an edit saves, offer to publish so staff see the change. Reset on
  // each successful save so a follow-up edit re-prompts.
  const [publishPromptDismissed, setPublishPromptDismissed] = useState(false);
  useEffect(() => {
    if (state.status === "ok") setPublishPromptDismissed(false);
  }, [state]);
  const showPublishPrompt =
    mode === "edit" && !!shiftId && state.status === "ok" && !publishPromptDismissed;

  const submitLabel = mode === "edit" ? "Save changes" : "Create shift";
  const pendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  // Refs into the underlying inputs so the "From template" select can
  // imperatively fill them — keeping the existing uncontrolled-form
  // pattern intact for everything else.
  const locationRef = useRef<HTMLSelectElement | null>(null);
  const roleRef = useRef<HTMLInputElement | null>(null);
  const startsRef = useRef<HTMLInputElement | null>(null);
  const endsRef = useRef<HTMLInputElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const skillRef = useRef<HTMLSelectElement | null>(null);

  // Dynamic break list. Serialized into a hidden `breaks` input on submit;
  // the server derives paid/unpaid totals from it.
  const nextBreakId = useRef(1);
  const [breaks, setBreaks] = useState<BreakRow[]>(
    (defaultValues?.breaks ?? []).map((b) => ({
      id: nextBreakId.current++,
      label: b.label ?? "",
      minutes: String(b.minutes),
      paid: b.paid,
    })),
  );
  function addBreak() {
    setBreaks((rows) => [
      ...rows,
      { id: nextBreakId.current++, label: "", minutes: "30", paid: false },
    ]);
  }
  function removeBreak(id: number) {
    setBreaks((rows) => rows.filter((r) => r.id !== id));
  }
  function updateBreak(id: number, patch: Partial<BreakRow>) {
    setBreaks((rows) =>
      rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  }
  const breaksPayload = JSON.stringify(
    breaks.map((b) => ({
      label: b.label,
      minutes: Number(b.minutes) || 0,
      paid: b.paid,
    })),
  );

  function applyTemplate(id: string) {
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // Compute concrete startsAt/endsAt by combining the template's
    // time-of-day with the date already in the form (or today).
    const baseDate = dateOnly(startsRef.current?.value ?? "");
    const startsAt = `${baseDate}T${pad(t.startHour)}:${pad(t.startMinute)}`;
    // Overnight: if end-of-day is before start-of-day, push end to the
    // next calendar day so the spread reads correctly.
    const startMins = t.startHour * 60 + t.startMinute;
    const endMins = t.endHour * 60 + t.endMinute;
    let endDate = baseDate;
    if (endMins <= startMins) {
      const [y, m, d] = baseDate.split("-").map(Number);
      const nextDay = new Date(y!, m! - 1, d! + 1);
      endDate = `${nextDay.getFullYear()}-${pad(nextDay.getMonth() + 1)}-${pad(nextDay.getDate())}`;
    }
    const endsAt = `${endDate}T${pad(t.endHour)}:${pad(t.endMinute)}`;

    if (locationRef.current) locationRef.current.value = t.locationId;
    if (roleRef.current) roleRef.current.value = t.role;
    if (startsRef.current) startsRef.current.value = startsAt;
    if (endsRef.current) endsRef.current.value = endsAt;
    if (notesRef.current && t.defaultNotes) {
      notesRef.current.value = t.defaultNotes;
    }
    // Prefill the break editor + required skill from the template. Breaks are
    // React state (the hidden `breaks` input is derived from it), so set it
    // directly; the skill <select> is uncontrolled, so set its value via ref.
    setBreaks(
      (t.defaultBreaks ?? []).map((b) => ({
        id: nextBreakId.current++,
        label: b.label ?? "",
        minutes: String(b.minutes),
        paid: b.paid,
      })),
    );
    if (skillRef.current) skillRef.current.value = t.requiredSkillId ?? "";
  }

  return (
    <>
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      {mode === "create" && templates.length > 0 && (
        <div className="space-y-1.5 sm:col-span-2 rounded-md border border-border bg-muted/30 p-3">
          <Label htmlFor="fromTemplate">From template (optional)</Label>
          <select
            id="fromTemplate"
            onChange={(e) => applyTemplate(e.target.value)}
            defaultValue=""
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="">— Pick to prefill the form —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {pad(t.startHour)}:{pad(t.startMinute)}–
                {pad(t.endHour)}:{pad(t.endMinute)} · {t.role}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            The template's time-of-day attaches to whatever date you've
            already picked (or today if none). Adjust afterwards as needed.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="locationId">Location</Label>
        <select
          ref={locationRef}
          id="locationId"
          name="locationId"
          defaultValue={defaultValues?.locationId ?? ""}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            — Choose a location —
          </option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.locationId && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.locationId[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Input
          ref={roleRef}
          id="role"
          name="role"
          defaultValue={defaultValues?.role ?? ""}
          placeholder="e.g. Butcher, Cashier, Cleaner"
          required
        />
        {state.status === "error" && state.fieldErrors?.role && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.role[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="startsAt">Starts</Label>
        <Input
          ref={startsRef}
          id="startsAt"
          name="startsAt"
          type="datetime-local"
          defaultValue={defaultValues?.startsAt ?? ""}
          required
          readOnly={startLocked}
          aria-readonly={startLocked}
          className={startLocked ? "cursor-not-allowed opacity-70" : undefined}
        />
        {startLocked ? (
          <p className="text-xs text-ink-3">
            This shift has already started — its start time is locked.
          </p>
        ) : null}
        {state.status === "error" && state.fieldErrors?.startsAt && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.startsAt[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endsAt">Ends</Label>
        <Input
          ref={endsRef}
          id="endsAt"
          name="endsAt"
          type="datetime-local"
          defaultValue={defaultValues?.endsAt ?? ""}
          required
        />
        {state.status === "error" && state.fieldErrors?.endsAt && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.endsAt[0]}
          </p>
        )}
      </div>

      <div className="space-y-2 sm:col-span-2">
        <div className="flex items-center justify-between">
          <Label>Breaks</Label>
          <Button type="button" variant="outline" size="sm" onClick={addBreak}>
            + Add break
          </Button>
        </div>
        {/* Serialized list the server reads + derives paid/unpaid totals from. */}
        <input type="hidden" name="breaks" value={breaksPayload} />
        {breaks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No breaks. Add one or more — unpaid minutes are deducted from net
            paid hours.
          </p>
        ) : (
          <ul className="space-y-2">
            {breaks.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-2"
              >
                <div className="min-w-[120px] flex-1 space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Label (optional)
                  </span>
                  <Input
                    value={b.label}
                    onChange={(e) => updateBreak(b.id, { label: e.target.value })}
                    placeholder="e.g. Lunch"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Minutes
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    step={5}
                    value={b.minutes}
                    onChange={(e) =>
                      updateBreak(b.id, { minutes: e.target.value })
                    }
                  />
                </div>
                <div className="w-28 space-y-1">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Type
                  </span>
                  <select
                    value={b.paid ? "paid" : "unpaid"}
                    onChange={(e) =>
                      updateBreak(b.id, { paid: e.target.value === "paid" })
                    }
                    className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                  >
                    <option value="unpaid">Unpaid</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeBreak(b.id)}
                  className="text-destructive hover:bg-destructive/10"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {skills.length > 0 && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="requiredSkillId">Required skill (optional)</Label>
          <select
            ref={skillRef}
            id="requiredSkillId"
            name="requiredSkillId"
            defaultValue={defaultValues?.requiredSkillId ?? ""}
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="">— Any qualification —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            The auto-scheduler refuses to assign anyone without this skill.
          </p>
        </div>
      )}

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          ref={notesRef}
          id="notes"
          name="notes"
          defaultValue={defaultValues?.notes ?? ""}
          rows={3}
          placeholder="Anything the assigned employee should know"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
    {showPublishPrompt && shiftId ? (
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warn)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] px-3 py-2">
        <span className="text-xs font-medium text-ink">
          Saved. Publish now so assigned staff see the change?
        </span>
        <form action={publishShiftAction} className="ml-auto">
          <input type="hidden" name="id" value={shiftId} />
          <Button type="submit" size="sm">
            Publish now
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPublishPromptDismissed(true)}
        >
          Not now
        </Button>
      </div>
    ) : null}
    </>
  );
}
