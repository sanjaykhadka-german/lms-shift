"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { addTimesheetEntryAction } from "./event-actions";

interface Props {
  employees: Array<{ userId: string; name: string | null; email: string }>;
  locations: Array<{ id: string; name: string }>;
  defaultDate: string; // YYYY-MM-DD
}

// Manager tool: enter a complete shift (start, finish, optional unpaid break)
// for a teammate who never clocked in — e.g. an onboarding employee. Emits
// the matching punches via addTimesheetEntryAction.
export function AddEntryForm({ employees, locations, defaultDate }: Props) {
  const fieldCls =
    "h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]";

  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-[var(--r-sm)] border border-[color:var(--input)] px-3 text-sm font-medium hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]">
        Add timesheet entry
      </summary>
      <form
        action={addTimesheetEntryAction}
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
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Break start (optional)
            <input type="time" name="breakStart" className={fieldCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-2">
            Break end (optional)
            <input type="time" name="breakEnd" className={fieldCls} />
          </label>
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
