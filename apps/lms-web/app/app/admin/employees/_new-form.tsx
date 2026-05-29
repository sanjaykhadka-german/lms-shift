"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createEmployeeAction } from "./actions";
import type { FormState } from "../_components/NameCrudForm";

const initial: FormState = { status: "idle" };

interface Props {
  departments: Array<{ id: number; name: string }>;
  employers: Array<{ id: number; name: string }>;
  positions: Array<{ id: number; name: string }>;
  publishedModules: Array<{ id: number; title: string }>;
  policiesByDept: Record<number, number[]>;
}

export function NewEmployeeForm({
  departments,
  employers,
  positions,
  publishedModules,
  policiesByDept,
}: Props) {
  const [state, formAction, pending] = useActionState(createEmployeeAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deptForModal, setDeptForModal] = useState<number | null>(null);
  const [extraIds, setExtraIds] = useState<Set<number>>(new Set());

  const fieldError = (k: string) =>
    state.status === "error" ? state.fieldErrors?.[k]?.[0] : undefined;

  const onAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = formRef.current;
    if (!form) return;
    if (!form.reportValidity()) return; // let HTML validation show
    if (publishedModules.length === 0) return; // nothing to pick, submit directly
    e.preventDefault();
    const deptValue = (form.elements.namedItem("department_id") as HTMLSelectElement | null)?.value ?? "";
    const did = /^\d+$/.test(deptValue) ? parseInt(deptValue, 10) : null;
    setDeptForModal(did);
    setExtraIds(new Set());
    setModalOpen(true);
  };

  const policyIds = new Set(
    deptForModal !== null ? policiesByDept[deptForModal] ?? [] : [],
  );
  const policyModules = publishedModules.filter((m) => policyIds.has(m.id));
  const optionalModules = publishedModules.filter((m) => !policyIds.has(m.id));

  const onConfirm = () => {
    setModalOpen(false);
    // Defer to next tick so the hidden inputs rendered from `extraIds` are
    // in the DOM before requestSubmit reads the form.
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  };

  const toggleExtra = (id: number) => {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Field label="First name" name="first_name" required error={fieldError("firstName")} />
        <Field label="Last name" name="last_name" required error={fieldError("lastName")} />
        <Field label="Email" name="email" type="email" required error={fieldError("email")} />
        <Field label="Phone" name="phone" required error={fieldError("phone")} />
        <Selectish
          label="Department"
          name="department_id"
          required
          options={departments.map((d) => ({ value: String(d.id), label: d.name }))}
          error={fieldError("departmentId")}
        />
        <DatalistField
          label="Employer"
          name="employer_name"
          listId="employer-list"
          options={employers.map((e) => e.name)}
          required
          error={fieldError("employerName")}
        />
        <Field label="Job title" name="job_title" />
        <Selectish
          label="Position"
          name="position_id"
          options={[
            { value: "", label: "— None —" },
            ...positions.map((p) => ({ value: String(p.id), label: p.name })),
          ]}
          defaultValue=""
        />
        <Selectish
          label="Role"
          name="role"
          options={[
            { value: "employee", label: "Employee" },
            { value: "qaqc", label: "QA/QC" },
            { value: "admin", label: "Admin (owners only)" },
          ]}
          defaultValue="employee"
        />
        <Field label="Start date" name="start_date" type="date" />
        <Field label="Termination date" name="termination_date" type="date" />

        {Array.from(extraIds).map((id) => (
          <input key={id} type="hidden" name="extra_module_ids" value={id} />
        ))}

        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3">
          <Button type="submit" disabled={pending} onClick={onAddClick}>
            {pending ? "Saving…" : "Add employee"}
          </Button>
          {state.status === "ok" && (
            <p className="text-xs text-emerald-600">{state.message}</p>
          )}
          {state.status === "error" && !state.fieldErrors && (
            <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
          )}
        </div>
      </form>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-employee-title"
        >
          <div
            className="w-full max-w-lg rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-employee-title" className="text-lg font-semibold">
              Confirm new employee
            </h2>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
              Review what will be assigned. Pick any extras to assign now.
            </p>

            <div className="mt-4 space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                Auto-assigned by department policy
              </div>
              {policyModules.length === 0 ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  No policy modules for this department.
                </p>
              ) : (
                <ul className="text-sm">
                  {policyModules.map((m) => (
                    <li key={m.id} className="py-1">
                      • {m.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                Also assign now (optional)
              </div>
              {optionalModules.length === 0 ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">
                  No other published modules available.
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-[color:var(--border)]">
                  {optionalModules.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                      <input
                        type="checkbox"
                        id={`extra-${m.id}`}
                        checked={extraIds.has(m.id)}
                        onChange={() => toggleExtra(m.id)}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`extra-${m.id}`} className="flex-1 cursor-pointer">
                        {m.title}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={onConfirm}>
                Confirm and add employee
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input id={name} name={name} type={type} required={required} aria-invalid={!!error} />
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}

function Selectish({
  label,
  name,
  options,
  required,
  error,
  defaultValue,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
  error?: string;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        required={required}
        className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        aria-invalid={!!error}
      >
        {required && !defaultValue && <option value="">— Select —</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}

function DatalistField({
  label,
  name,
  listId,
  options,
  required,
  error,
}: {
  label: string;
  name: string;
  listId: string;
  options: string[];
  required?: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {required && " *"}
      </Label>
      <Input
        id={name}
        name={name}
        list={listId}
        required={required}
        aria-invalid={!!error}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <p className="text-xs text-[color:var(--muted-foreground)]">
        Type a new name to create one.
      </p>
      {error && <p className="text-xs text-[color:var(--destructive)]">{error}</p>}
    </div>
  );
}
