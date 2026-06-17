"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { startOnboardingBulkAction } from "./_actions";

// Checkbox list + "select all" so a manager can start onboarding for one,
// several, or every eligible employee in a single submit. Controlled
// checkboxes named `employeeIds` submit one value each when ticked, which the
// server action reads via formData.getAll.
export function BulkStartForm({
  employees,
}: {
  employees: { id: string; fullName: string; email: string | null }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allSelected =
    employees.length > 0 && selected.size === employees.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(employees.map((e) => e.id)));
  }

  return (
    <form action={startOnboardingBulkAction} className="space-y-3 px-5 py-4">
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="h-4 w-4 rounded border-border"
        />
        Select all ({employees.length})
      </label>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {employees.map((e) => (
          <li key={e.id}>
            <label className="flex items-center gap-2 px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="employeeIds"
                value={e.id}
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
                className="h-4 w-4 rounded border-border"
              />
              <span className="truncate">
                {e.fullName}
                {e.email ? (
                  <span className="text-muted-foreground"> · {e.email}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <SubmitButton count={selected.size} />
    </form>
  );
}

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending
        ? "Starting…"
        : count === 0
          ? "Select employees to start"
          : `Start onboarding (${count})`}
    </Button>
  );
}
