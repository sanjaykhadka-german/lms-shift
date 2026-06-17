"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { setClockPolicyAction, type SettingsFormState } from "./actions";
import type { ClockPolicy } from "~/lib/clock-policy";

const INITIAL: SettingsFormState = { status: "idle" };

const TOGGLES: Array<{
  name: keyof ClockPolicy;
  label: string;
  hint: string;
}> = [
  {
    name: "allowWebClock",
    label: "Allow web clock-in",
    hint: "Let staff clock in/out from the web app. Turn off to force all punches through a kiosk.",
  },
  {
    name: "requireScheduledShift",
    label: "Require a scheduled shift",
    hint: "Staff can only clock in when they're rostered. (Unless unscheduled shifts are allowed below.)",
  },
  {
    name: "allowUnscheduledClockIn",
    label: "Allow unscheduled shifts",
    hint: "Let staff start a shift they aren't rostered for. These punches are flagged on the timesheet for review.",
  },
  {
    name: "requireGeofence",
    label: "Require location (geofence)",
    hint: "A web punch must resolve inside a location's geofence (needs GPS + a geofenced location).",
  },
  {
    name: "requireSelfie",
    label: "Require a photo",
    hint: "Staff must capture a selfie on clock in / out.",
  },
];

export function ClockPolicyForm({ current }: { current: ClockPolicy }) {
  const [state, formAction] = useActionState(setClockPolicyAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      {TOGGLES.map((t) => (
        <label
          key={t.name}
          className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40 cursor-pointer"
        >
          <input
            type="checkbox"
            name={t.name}
            defaultChecked={current[t.name]}
            className="mt-1"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t.hint}</div>
          </div>
        </label>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <SubmitButton />
        {state.status === "ok" ? (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save clock-in policy"}
    </Button>
  );
}
