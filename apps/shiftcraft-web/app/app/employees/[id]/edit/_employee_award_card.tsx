"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  setEmployeeAwardProfileAction,
  type EmployeeAwardFormState,
} from "../../new/actions";
import type { AwardProfileOverrides } from "~/lib/timesheet-classifier";

// Package defaults — used as the final fallback placeholder when neither
// the employee nor the tenant has set a field.
const PACKAGE_DEFAULTS = {
  dailyOrdinaryMinutes: 480,
  dailyOvertimeMinutes: 600,
  weeklyOrdinaryMinutes: 2280,
  overtimeMultiplier: 1.5,
  doubleOvertimeMultiplier: 2.0,
  penaltyWeekday: 1.0,
  penaltySaturday: 1.25,
  penaltySunday: 1.5,
  penaltyPublicHoliday: 2.5,
};

const INITIAL: EmployeeAwardFormState = { status: "idle" };

interface Props {
  employeeId: string;
  tenantProfile: AwardProfileOverrides;
  employeeProfile: AwardProfileOverrides;
}

// Reads the current value of a given field from the employee profile —
// returns "" when not overridden so the input renders blank.
function empValue(
  profile: AwardProfileOverrides,
  key: keyof typeof PACKAGE_DEFAULTS,
): string {
  switch (key) {
    case "dailyOrdinaryMinutes":
      return profile.thresholds?.dailyOrdinaryMinutes?.toString() ?? "";
    case "dailyOvertimeMinutes":
      return profile.thresholds?.dailyOvertimeMinutes?.toString() ?? "";
    case "weeklyOrdinaryMinutes":
      return profile.thresholds?.weeklyOrdinaryMinutes?.toString() ?? "";
    case "overtimeMultiplier":
      return profile.overtimeMultiplier?.toString() ?? "";
    case "doubleOvertimeMultiplier":
      return profile.doubleOvertimeMultiplier?.toString() ?? "";
    case "penaltyWeekday":
      return profile.penaltyMultipliers?.weekday?.toString() ?? "";
    case "penaltySaturday":
      return profile.penaltyMultipliers?.saturday?.toString() ?? "";
    case "penaltySunday":
      return profile.penaltyMultipliers?.sunday?.toString() ?? "";
    case "penaltyPublicHoliday":
      return profile.penaltyMultipliers?.public_holiday?.toString() ?? "";
    default:
      return "";
  }
}

// Builds the placeholder shown in the input — tenant value if set, else
// the AU package default. Adds an "(inherited)" suffix so the manager
// knows the value isn't typed locally.
function inheritedPlaceholder(
  tenant: AwardProfileOverrides,
  key: keyof typeof PACKAGE_DEFAULTS,
): string {
  const t = empValue(tenant, key);
  const value = t !== "" ? t : PACKAGE_DEFAULTS[key].toString();
  const source = t !== "" ? "tenant" : "default";
  return `${value} (${source})`;
}

export function EmployeeAwardProfileCard({
  employeeId,
  tenantProfile,
  employeeProfile,
}: Props) {
  const bound = setEmployeeAwardProfileAction.bind(null, employeeId);
  const [state, formAction] = useActionState(bound, INITIAL);
  const currentPolicy = employeeProfile.costPolicy ?? "";
  const tenantPolicy = tenantProfile.costPolicy ?? "max";

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 className="text-sm font-semibold">Award profile override</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Override the workspace award profile for this one employee.
          Leave any field blank to inherit the workspace value
          (placeholder shows what would apply). Use this when an
          employee is on a different contract or modern award.
        </p>
      </div>

      <form action={formAction} className="mt-4 space-y-5">
        <input type="hidden" name="intent" value="save" />

        <FieldGroup title="Thresholds (minutes)">
          <NumberField
            name="dailyOrdinaryMinutes"
            label="Daily ordinary"
            defaultValue={empValue(employeeProfile, "dailyOrdinaryMinutes")}
            placeholder={inheritedPlaceholder(
              tenantProfile,
              "dailyOrdinaryMinutes",
            )}
            step={1}
            state={state}
          />
          <NumberField
            name="dailyOvertimeMinutes"
            label="Daily OT ceiling"
            defaultValue={empValue(employeeProfile, "dailyOvertimeMinutes")}
            placeholder={inheritedPlaceholder(
              tenantProfile,
              "dailyOvertimeMinutes",
            )}
            step={1}
            state={state}
          />
          <NumberField
            name="weeklyOrdinaryMinutes"
            label="Weekly ordinary"
            defaultValue={empValue(employeeProfile, "weeklyOrdinaryMinutes")}
            placeholder={inheritedPlaceholder(
              tenantProfile,
              "weeklyOrdinaryMinutes",
            )}
            step={1}
            state={state}
          />
        </FieldGroup>

        <FieldGroup title="Overtime multipliers (×)">
          <NumberField
            name="overtimeMultiplier"
            label="OT 1.5× band"
            defaultValue={empValue(employeeProfile, "overtimeMultiplier")}
            placeholder={inheritedPlaceholder(tenantProfile, "overtimeMultiplier")}
            step={0.01}
            state={state}
          />
          <NumberField
            name="doubleOvertimeMultiplier"
            label="OT 2× band"
            defaultValue={empValue(employeeProfile, "doubleOvertimeMultiplier")}
            placeholder={inheritedPlaceholder(
              tenantProfile,
              "doubleOvertimeMultiplier",
            )}
            step={0.01}
            state={state}
          />
        </FieldGroup>

        <FieldGroup title="Penalty multipliers (×)">
          <NumberField
            name="penaltyWeekday"
            label="Weekday"
            defaultValue={empValue(employeeProfile, "penaltyWeekday")}
            placeholder={inheritedPlaceholder(tenantProfile, "penaltyWeekday")}
            step={0.01}
            state={state}
          />
          <NumberField
            name="penaltySaturday"
            label="Saturday"
            defaultValue={empValue(employeeProfile, "penaltySaturday")}
            placeholder={inheritedPlaceholder(tenantProfile, "penaltySaturday")}
            step={0.01}
            state={state}
          />
          <NumberField
            name="penaltySunday"
            label="Sunday"
            defaultValue={empValue(employeeProfile, "penaltySunday")}
            placeholder={inheritedPlaceholder(tenantProfile, "penaltySunday")}
            step={0.01}
            state={state}
          />
          <NumberField
            name="penaltyPublicHoliday"
            label="Public holiday"
            defaultValue={empValue(employeeProfile, "penaltyPublicHoliday")}
            placeholder={inheritedPlaceholder(
              tenantProfile,
              "penaltyPublicHoliday",
            )}
            step={0.01}
            state={state}
          />
        </FieldGroup>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cost policy
          </legend>
          <p className="text-xs text-muted-foreground">
            Blank inherits the workspace setting ({tenantPolicy}). Pick
            an explicit value to override just for this employee.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="costPolicy"
                value=""
                defaultChecked={currentPolicy === ""}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>Inherit ({tenantPolicy})</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="costPolicy"
                value="max"
                defaultChecked={currentPolicy === "max"}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>Max</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="costPolicy"
                value="stack"
                defaultChecked={currentPolicy === "stack"}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span>Stack</span>
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <SaveButton />
          <ResetButton />
          {state.status === "ok" ? (
            <p className="text-xs text-emerald-600">{state.message}</p>
          ) : null}
          {state.status === "error" && !state.fieldErrors ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function FieldGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  placeholder,
  step,
  state,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  step: number;
  state: EmployeeAwardFormState;
}) {
  const fieldError =
    state.status === "error"
      ? state.fieldErrors?.[name]?.[0] ?? null
      : null;
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        step={step}
        min={0}
        className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {fieldError ? (
        <span className="text-[color:var(--destructive)]">{fieldError}</span>
      ) : null}
    </label>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save override"}
    </Button>
  );
}

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value="reset"
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-[color:var(--destructive)] hover:underline disabled:opacity-50"
      title="Clear the override — this employee will inherit the workspace award profile"
    >
      Clear override
    </button>
  );
}
