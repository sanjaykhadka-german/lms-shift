"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { startOnboardingBulkAction } from "./_actions";

// Checkbox list + "select all" so a manager can start onboarding for one,
// several, or every eligible employee in a single submit. Controlled
// checkboxes named `employeeIds` submit one value each when ticked, which the
// server action reads via formData.getAll.
//
// R2 — a department filter narrows the list so "onboard all of Dispatch" is
// pick Dispatch → Select all in Dispatch → Start. Changing the filter clears
// the selection (only rendered checkboxes post, so a hidden pick can't sneak
// through).
export function BulkStartForm({
  employees,
  departments,
}: {
  employees: {
    id: string;
    fullName: string;
    email: string | null;
    departmentId: string | null;
  }[];
  departments: { id: string; name: string }[];
}) {
  const [dept, setDept] = useState<string>(""); // "" = all, "none" = no dept
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible =
    dept === ""
      ? employees
      : dept === "none"
        ? employees.filter((e) => !e.departmentId)
        : employees.filter((e) => e.departmentId === dept);

  const allSelected =
    visible.length > 0 && visible.every((e) => selected.has(e.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of visible) {
        if (allSelected) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  }
  function changeDept(v: string) {
    setDept(v);
    setSelected(new Set());
  }

  const deptLabel =
    dept === ""
      ? "all"
      : dept === "none"
        ? "no department"
        : (departments.find((d) => d.id === dept)?.name ?? "department");

  return (
    <form action={startOnboardingBulkAction} className="space-y-3 px-5 py-4">
      {departments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label
            htmlFor="onb-dept"
            className="font-medium text-muted-foreground"
          >
            Department:
          </label>
          <select
            id="onb-dept"
            value={dept}
            onChange={(e) => changeDept(e.target.value)}
            className="h-8 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="">All departments</option>
            <option value="none">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="h-4 w-4 rounded border-border"
        />
        Select all in {deptLabel} ({visible.length})
      </label>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground">
            No eligible employees in {deptLabel}.
          </li>
        ) : (
          visible.map((e) => (
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
          ))
        )}
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
