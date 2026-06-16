"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { assignEmployeeAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

interface Props {
  shiftId: string;
  availableEmployees: Array<{ id: string; name: string | null; email: string }>;
}

export function AssignForm({ shiftId, availableEmployees }: Props) {
  const [state, formAction, pending] = useActionState(assignEmployeeAction, initial);

  if (availableEmployees.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        All current members are already assigned to this shift.
      </p>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="shiftId" value={shiftId} />
      <div className="space-y-1.5">
        <Label htmlFor="userId">Schedule this shift for</Label>
        <select
          id="userId"
          name="userId"
          defaultValue=""
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            — Choose employee —
          </option>
          {availableEmployees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name ?? e.email}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.userId && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.userId[0]}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Scheduling…" : "Schedule"}
      </Button>
      {state.status === "ok" && (
        <p className="text-xs text-[var(--live)] sm:col-span-2">{state.message}</p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="text-xs text-[color:var(--destructive)] sm:col-span-2">
          {state.message}
        </p>
      )}
    </form>
  );
}
