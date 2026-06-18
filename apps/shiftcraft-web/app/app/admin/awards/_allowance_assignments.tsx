"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setEmployeeAllowancesAction, type FormState } from "./actions";

const INITIAL: FormState = { status: "idle" };

interface AllowanceOption {
  id: string;
  key: string;
  label: string;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  allowanceIds: string[];
}

export function AllowanceAssignmentsCard({
  employees,
  allowances,
}: {
  employees: EmployeeRow[];
  allowances: AllowanceOption[];
}) {
  if (allowances.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Allowances per person</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Tick the allowances each team member receives, then Save the row.
      </p>
      <div className="mt-3 space-y-1.5">
        {employees.map((e) => (
          <RowForm key={e.id} employee={e} allowances={allowances} />
        ))}
        {employees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active team members.</p>
        ) : null}
      </div>
    </section>
  );
}

function RowForm({
  employee,
  allowances,
}: {
  employee: EmployeeRow;
  allowances: AllowanceOption[];
}) {
  const [, action] = useActionState(setEmployeeAllowancesAction, INITIAL);
  const assigned = new Set(employee.allowanceIds);
  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
    >
      <input type="hidden" name="employeeId" value={employee.id} />
      <span className="min-w-[140px] font-medium text-ink">
        {employee.fullName}
      </span>
      <div className="flex flex-1 flex-wrap gap-3">
        {allowances.map((a) => (
          <label key={a.id} className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              name="allowanceId"
              value={a.id}
              defaultChecked={assigned.has(a.id)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span title={a.key}>{a.label}</span>
          </label>
        ))}
      </div>
      <SaveButton />
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "…" : "Save"}
    </button>
  );
}
