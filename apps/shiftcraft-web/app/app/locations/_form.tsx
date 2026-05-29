"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createLocationAction, type LocationFormState } from "./actions";

const initial: LocationFormState = { status: "idle" };

export function CreateLocationForm({ timezones }: { timezones: readonly string[] }) {
  const [state, action, pending] = useActionState(createLocationAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful add so the next one starts blank.
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            placeholder="e.g. Main Store"
            required
            aria-invalid={
              state.status === "error" && !!state.fieldErrors?.name ? true : undefined
            }
          />
          {state.status === "error" && state.fieldErrors?.name && (
            <p className="text-xs text-red-600">{state.fieldErrors.name[0]}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            name="timezone"
            defaultValue="Australia/Sydney"
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="address">Address (optional)</Label>
        <Input id="address" name="address" placeholder="Street, suburb, state" />
      </div>

      {state.status === "error" && !state.fieldErrors && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      {state.status === "ok" && (
        <p className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-700">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add location"}
      </Button>
    </form>
  );
}
