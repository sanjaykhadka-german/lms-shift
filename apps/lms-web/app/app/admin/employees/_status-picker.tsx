"use client";

import type { EmployeeStatus } from "~/lib/lms/employee-status";
import { setEmployeeStatusAction } from "./actions";

interface Props {
  id: number;
  status: EmployeeStatus;
  terminationDate: string | null;
}

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Active",
  disabled: "Disabled",
  terminated: "Terminated",
};

// Tailwind utility classes per state — applied to the select so the row
// gets a colour hint without needing a separate badge.
const STATUS_CLASS: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500 text-white dark:bg-emerald-400 dark:text-emerald-950",
  disabled: "bg-amber-500 text-white dark:bg-amber-400 dark:text-amber-950",
  terminated:
    "bg-[color:var(--secondary)] text-[color:var(--muted-foreground)]",
};

export function StatusPicker({ id, status, terminationDate }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      <form action={setEmployeeStatusAction} className="contents">
        <input type="hidden" name="id" value={id} />
        <select
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          aria-label="Employee status"
          className={`h-6 rounded-full border-0 px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] ${STATUS_CLASS[status]}`}
        >
          <option value="active">{STATUS_LABEL.active}</option>
          <option value="disabled">{STATUS_LABEL.disabled}</option>
          <option value="terminated">{STATUS_LABEL.terminated}</option>
        </select>
      </form>
      {status === "terminated" && terminationDate && (
        <span className="text-[10px] text-[color:var(--muted-foreground)]">
          since {terminationDate}
        </span>
      )}
    </div>
  );
}
