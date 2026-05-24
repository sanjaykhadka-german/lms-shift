"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createEmployeeAction,
  updateEmployeeAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

export interface EmployeeFormDefaults {
  fullName: string;
  email: string | null;
  mobile: string | null;
  department: string | null;
  employmentType: string;
  hourlyRate: string | null;
  notes: string | null;
  availability: Record<string, string> | null;
  preferredName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  addressLine: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

const GENDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Prefer not to say" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say (recorded)" },
];

const EMPLOYMENT_TYPES: Array<{ value: string; label: string; hint: string }> = [
  {
    value: "permanent",
    label: "Permanent",
    hint: "Ongoing employee. Will trigger a training suggestion if email is set.",
  },
  {
    value: "casual",
    label: "Casual",
    hint: "Variable hours. Will trigger a training suggestion if email is set.",
  },
  {
    value: "labour_hire",
    label: "Labour hire",
    hint: "Roster-only. No LMS suggestion — not added to training cohort.",
  },
];

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function fieldError(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  const errs = state.fieldErrors?.[key];
  return errs && errs.length > 0 ? (errs[0] ?? null) : null;
}

interface Props {
  mode?: "create" | "edit";
  employeeId?: string;
  defaultValues?: EmployeeFormDefaults;
  /** Known department names for the tenant — populates the datalist. */
  departmentSuggestions?: string[];
}

export function EmployeeForm({
  mode = "create",
  employeeId,
  defaultValues,
  departmentSuggestions = [],
}: Props) {
  const action =
    mode === "edit" && employeeId
      ? updateEmployeeAction.bind(null, employeeId)
      : createEmployeeAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Add employee";
  const pendingLabel = mode === "edit" ? "Saving…" : "Adding…";
  const v = defaultValues;

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            name="fullName"
            defaultValue={v?.fullName ?? ""}
            placeholder="e.g. Jane Doe"
            required
            aria-invalid={!!fieldError(state, "fullName")}
          />
          {fieldError(state, "fullName") && (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "fullName")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={v?.email ?? ""}
            placeholder="jane@example.com"
            aria-invalid={!!fieldError(state, "email")}
          />
          {fieldError(state, "email") ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "email")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Required for learner suggestion. Leave blank for labour-hire.
            </p>
          )}
          {mode === "create" ? (
            <label className="mt-2 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                name="sendInvite"
                defaultChecked
                className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span className="text-muted-foreground">
                Email them a link to create their account. Ignored if email
                is empty or employment type is labour-hire.
              </span>
            </label>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mobile">Mobile</Label>
          <Input
            id="mobile"
            name="mobile"
            defaultValue={v?.mobile ?? ""}
            placeholder="0400 000 000"
            aria-invalid={!!fieldError(state, "mobile")}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="department">Department</Label>
          <Input
            id="department"
            name="department"
            list="employee-department-options"
            defaultValue={v?.department ?? ""}
            placeholder="e.g. Butchery"
            aria-invalid={!!fieldError(state, "department")}
            autoComplete="off"
          />
          <datalist id="employee-department-options">
            {departmentSuggestions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          {departmentSuggestions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Pick an existing department or type a new one — it'll be
              created automatically.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="employmentType">Employment type</Label>
          <select
            id="employmentType"
            name="employmentType"
            defaultValue={v?.employmentType ?? "permanent"}
            required
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {fieldError(state, "employmentType") && (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "employmentType")}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hourlyRate">Hourly rate (optional)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <Input
              id="hourlyRate"
              name="hourlyRate"
              defaultValue={v?.hourlyRate ?? ""}
              inputMode="decimal"
              placeholder="24.50"
              className="pl-7"
              aria-invalid={!!fieldError(state, "hourlyRate")}
            />
          </div>
          {fieldError(state, "hourlyRate") ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {fieldError(state, "hourlyRate")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Used to compute wage costs in Reports. Leave blank for "rate
              not set".
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Weekly availability (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Free text per day, e.g. "9-5" or "evenings only". Leave blank for
          unspecified.
        </p>
        <div className="grid gap-2 sm:grid-cols-7">
          {WEEKDAYS.map((d) => (
            <div key={d.key} className="space-y-1">
              <Label
                htmlFor={`availability_${d.key}`}
                className="text-xs text-muted-foreground"
              >
                {d.label}
              </Label>
              <Input
                id={`availability_${d.key}`}
                name={`availability_${d.key}`}
                defaultValue={v?.availability?.[d.key] ?? ""}
                placeholder="—"
                className="h-8 text-xs"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Personal details ─── */}
      <fieldset className="space-y-4 rounded-md border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Personal details
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="preferredName">Preferred name</Label>
            <Input
              id="preferredName"
              name="preferredName"
              defaultValue={v?.preferredName ?? ""}
              placeholder="e.g. Janie"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gender">Gender</Label>
            <select
              id="gender"
              name="gender"
              defaultValue={v?.gender ?? ""}
              className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            >
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              defaultValue={v?.dateOfBirth ?? ""}
              aria-invalid={!!fieldError(state, "dateOfBirth")}
            />
            {fieldError(state, "dateOfBirth") && (
              <p className="text-xs text-[color:var(--destructive)]">
                {fieldError(state, "dateOfBirth")}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addressLine">Address</Label>
            <Input
              id="addressLine"
              name="addressLine"
              defaultValue={v?.addressLine ?? ""}
              placeholder="Street, suburb, state, postcode"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactName">Emergency contact</Label>
            <Input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={v?.emergencyContactName ?? ""}
              placeholder="Full name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactPhone">Emergency contact phone</Label>
            <Input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              defaultValue={v?.emergencyContactPhone ?? ""}
              placeholder="0400 000 000"
            />
          </div>
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={v?.notes ?? ""}
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          placeholder="Anything the rostering team should know."
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
