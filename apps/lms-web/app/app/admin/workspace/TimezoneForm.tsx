"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  updateWorkspaceTimezoneAction,
  type WorkspaceFormState,
} from "./actions";

const initial: WorkspaceFormState = { status: "idle" };

interface Props {
  current: string;
  zones: string[];
}

export function TimezoneForm({ current, zones }: Props) {
  const [state, formAction, pending] = useActionState(
    updateWorkspaceTimezoneAction,
    initial,
  );
  const hasCurrent = zones.includes(current);
  const options = hasCurrent ? zones : [current, ...zones];

  return (
    <form
      action={formAction}
      className="space-y-4"
      key={state.status === "ok" ? state.message : "form"}
    >
      <div className="space-y-1.5">
        <Label htmlFor="timezone">Workspace timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={current}
          className="block h-9 w-full max-w-sm rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <p className="text-xs text-[color:var(--muted-foreground)]">
          All dates and times across the workspace are displayed in this timezone.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
