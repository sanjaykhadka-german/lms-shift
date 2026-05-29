"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  setHolidayRegionAction,
  type SettingsFormState,
} from "./actions";

const INITIAL: SettingsFormState = { status: "idle" };

interface Props {
  currentRegion: string;
  regions: ReadonlyArray<string>;
  labels: Record<string, string>;
}

export function HolidayRegionForm({ currentRegion, regions, labels }: Props) {
  const [state, formAction] = useActionState(setHolidayRegionAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <label htmlFor="region" className="block text-xs font-medium text-muted-foreground">
        Region
      </label>
      <select
        id="region"
        name="region"
        defaultValue={currentRegion}
        className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {regions.map((r) => (
          <option key={r} value={r}>
            {labels[r] ?? r}
          </option>
        ))}
      </select>

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
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
