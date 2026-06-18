"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  setAwardProfileAction,
  type SettingsFormState,
} from "./actions";
import type { AwardProfileOverrides } from "~/lib/timesheet-classifier";

// Default placeholders mirror @tracey/award DEFAULT_THRESHOLDS +
// DEFAULT_PENALTY_MULTIPLIERS so an empty input visibly defaults to
// the AU baseline. Server treats blank as "no override".
const DEFAULTS = {
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

const INITIAL: SettingsFormState = { status: "idle" };

interface Props {
  currentProfile: AwardProfileOverrides;
  currentAwardCode: string | null;
  currentEffectiveFrom: string | null;
  awardOptions: Array<{ code: string; name: string }>;
}

function pms(profile: AwardProfileOverrides, key: keyof typeof DEFAULTS): string {
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

export function AwardProfileForm({
  currentProfile,
  currentAwardCode,
  currentEffectiveFrom,
  awardOptions,
}: Props) {
  const [state, formAction] = useActionState(setAwardProfileAction, INITIAL);
  const currentPolicy = currentProfile.costPolicy ?? "max";
  const activeAward = awardOptions.find((a) => a.code === currentAwardCode);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="intent" value="save" />

      <fieldset className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Industry / Award
        </legend>
        <p className="text-xs text-muted-foreground">
          Pick your Modern Award to stamp its hours + penalty structure into the
          fields below. <strong>Rates still need verifying against Fair Work</strong>{" "}
          — applying a preset sets the rules, not the dollar amounts (those come
          from the Fair Work pull).
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted-foreground">Award</span>
            <select
              name="awardCode"
              defaultValue={currentAwardCode ?? ""}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— Select an award —</option>
              {awardOptions.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name} ({a.code})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            name="intent"
            value="apply_preset"
            className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
            title="Stamp this award's rule structure into the fields below"
          >
            Apply / re-apply preset
          </button>
        </div>
        {activeAward ? (
          <p className="text-xs text-muted-foreground">
            Active: <strong>{activeAward.name}</strong>
            {currentEffectiveFrom ? ` · effective ${currentEffectiveFrom}` : ""}
          </p>
        ) : null}
      </fieldset>

      <FieldGroup title="Thresholds (minutes)">
        <NumberField
          name="dailyOrdinaryMinutes"
          label="Daily ordinary"
          defaultValue={pms(currentProfile, "dailyOrdinaryMinutes")}
          placeholder={`${DEFAULTS.dailyOrdinaryMinutes} (8h)`}
          step={1}
          state={state}
        />
        <NumberField
          name="dailyOvertimeMinutes"
          label="Daily OT ceiling"
          defaultValue={pms(currentProfile, "dailyOvertimeMinutes")}
          placeholder={`${DEFAULTS.dailyOvertimeMinutes} (10h)`}
          step={1}
          state={state}
        />
        <NumberField
          name="weeklyOrdinaryMinutes"
          label="Weekly ordinary"
          defaultValue={pms(currentProfile, "weeklyOrdinaryMinutes")}
          placeholder={`${DEFAULTS.weeklyOrdinaryMinutes} (38h)`}
          step={1}
          state={state}
        />
      </FieldGroup>

      <FieldGroup title="Overtime multipliers (×)">
        <NumberField
          name="overtimeMultiplier"
          label="OT 1.5× band"
          defaultValue={pms(currentProfile, "overtimeMultiplier")}
          placeholder={DEFAULTS.overtimeMultiplier.toString()}
          step={0.01}
          state={state}
        />
        <NumberField
          name="doubleOvertimeMultiplier"
          label="OT 2× band"
          defaultValue={pms(currentProfile, "doubleOvertimeMultiplier")}
          placeholder={DEFAULTS.doubleOvertimeMultiplier.toString()}
          step={0.01}
          state={state}
        />
      </FieldGroup>

      <FieldGroup title="Penalty multipliers (×)">
        <NumberField
          name="penaltyWeekday"
          label="Weekday"
          defaultValue={pms(currentProfile, "penaltyWeekday")}
          placeholder={DEFAULTS.penaltyWeekday.toString()}
          step={0.01}
          state={state}
        />
        <NumberField
          name="penaltySaturday"
          label="Saturday"
          defaultValue={pms(currentProfile, "penaltySaturday")}
          placeholder={DEFAULTS.penaltySaturday.toString()}
          step={0.01}
          state={state}
        />
        <NumberField
          name="penaltySunday"
          label="Sunday"
          defaultValue={pms(currentProfile, "penaltySunday")}
          placeholder={DEFAULTS.penaltySunday.toString()}
          step={0.01}
          state={state}
        />
        <NumberField
          name="penaltyPublicHoliday"
          label="Public holiday"
          defaultValue={pms(currentProfile, "penaltyPublicHoliday")}
          placeholder={DEFAULTS.penaltyPublicHoliday.toString()}
          step={0.01}
          state={state}
        />
      </FieldGroup>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Cost policy
        </legend>
        <p className="text-xs text-muted-foreground">
          <strong>Max</strong>: pay = max(penalty, OT) — non-stacking. Default
          AU baseline.{" "}
          <strong>Stack</strong>: pay = penalty × OT — used by awards that
          compound (e.g. General Retail Sun + OT = 2.25×).
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="costPolicy"
              value="max"
              defaultChecked={currentPolicy === "max"}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>Max (default)</span>
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
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}
        {state.status === "error" && !state.fieldErrors ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
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
  state: SettingsFormState;
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
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

// Submits the same form with `intent=reset`. We swap the hidden input
// via formData on the click using a separate button + formAction
// pattern that React 19 supports inside the same form.
function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value="reset"
      disabled={pending}
      className="text-xs text-muted-foreground hover:text-[color:var(--destructive)] hover:underline disabled:opacity-50"
      title="Clear all overrides — uses the @tracey/award AU baseline defaults"
    >
      Reset to defaults
    </button>
  );
}
