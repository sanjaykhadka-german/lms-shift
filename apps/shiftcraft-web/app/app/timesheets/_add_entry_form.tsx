"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { addTimesheetEntryAction } from "./event-actions";

interface Props {
  employees: Array<{ userId: string; name: string | null; email: string }>;
  locations: Array<{ id: string; name: string }>;
  defaultDate: string; // YYYY-MM-DD
}

// Manager tool: enter a complete shift (start, finish, and any number of breaks
// — none, one, or several) for a teammate who never clocked in, e.g. an
// onboarding employee. Emits the matching in / break_start / break_end / out
// punches via addTimesheetEntryAction. Breaks are a dynamic list (item 6): the
// structure is start → break → break → … → finish.
export function AddEntryForm({ employees, locations, defaultDate }: Props) {
  const fieldCls =
    "h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]";

  // Each entry is just a stable key; the time values live in uncontrolled
  // inputs named breakStart/breakEnd, read in order on the server via getAll.
  const nextBreakId = useRef(1);
  const [breakRows, setBreakRows] = useState<number[]>([]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const addBreak = () =>
    setBreakRows((rows) => [...rows, nextBreakId.current++]);
  const removeBreak = (id: number) =>
    setBreakRows((rows) => rows.filter((r) => r !== id));

  return (
    <details ref={detailsRef} className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-[var(--r-sm)] border border-[color:var(--input)] px-3 text-sm font-medium hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]">
        Add timesheet entry
      </summary>
      <form
        ref={formRef}
        action={async (fd) => {
          await addTimesheetEntryAction(fd);
          // Success (the action revalidates and returns; it never redirects).
          // Reset the form, drop any break rows, and collapse the dropdown.
          formRef.current?.reset();
          setBreakRows([]);
          detailsRef.current?.removeAttribute("open");
        }}
        className="absolute right-0 z-10 mt-1 grid w-[320px] gap-2 rounded-[var(--r-sm)] border border-border bg-card p-3 shadow-lg"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Employee
          <select name="appUserId" required defaultValue="" className={fieldCls}>
            <option value="" disabled>
              — Choose employee —
            </option>
            {employees.map((e) => (
              <option key={e.userId} value={e.userId}>
                {e.name ?? e.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Date
          <input type="date" name="date" required defaultValue={defaultDate} className={fieldCls} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Start
            <input type="time" name="clockIn" required className={fieldCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Finish
            <input type="time" name="clockOut" required className={fieldCls} />
          </label>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-2">Breaks</span>
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
            breakRows.map((id, idx) => (
              <div key={id} className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-ink-2">
                  {idx === 0 ? "Break start" : `Break ${idx + 1} start`}
                  <input type="time" name="breakStart" required className={fieldCls} />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-ink-2">
                  End
                  <input type="time" name="breakEnd" required className={fieldCls} />
                </label>
                <button
                  type="button"
                  onClick={() => removeBreak(id)}
                  aria-label="Remove break"
                  className="mb-1 px-1 text-xs text-muted-foreground hover:text-[color:var(--destructive)]"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        {locations.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Location (optional)
            <select name="locationId" defaultValue="" className={fieldCls}>
              <option value="">— None —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          Reason / note
          <input
            type="text"
            name="reason"
            required
            maxLength={200}
            placeholder="e.g. onboarding — paper timesheet"
            className={fieldCls}
          />
        </label>
        <SubmitButton />
      </form>
    </details>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add entry"}
    </Button>
  );
}
