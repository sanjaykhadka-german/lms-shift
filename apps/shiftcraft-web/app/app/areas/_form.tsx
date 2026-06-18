"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createAreaAction, updateAreaAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

interface Props {
  mode: "create" | "edit";
  areaId?: string;
  locations: Array<{ id: string; name: string }>;
  defaultValues?: {
    locationId: string;
    /** Display name of the fixed location (edit mode). */
    locationName?: string;
    name: string;
    color: string | null;
  };
}

function fieldErr(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[key]?.[0] ?? null;
}

export function AreaForm({ mode, areaId, locations, defaultValues }: Props) {
  const action =
    mode === "edit" && areaId
      ? updateAreaAction.bind(null, areaId)
      : createAreaAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Create area";
  const pendingLabel = mode === "edit" ? "Saving…" : "Creating…";

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="locationId">Location</Label>
        {mode === "edit" ? (
          // Location is fixed on edit (rename-cascade keys off it). Show it
          // read-only; nothing is submitted since the edit action ignores it.
          <p className="flex h-9 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
            {defaultValues?.locationName ?? "—"}
          </p>
        ) : (
          <select
            id="locationId"
            name="locationId"
            defaultValue={defaultValues?.locationId ?? ""}
            required
            className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="" disabled>
              — Choose a location —
            </option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        )}
        {fieldErr(state, "locationId") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "locationId")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Butchery, Front Counter, Kitchen"
          required
          aria-invalid={!!fieldErr(state, "name")}
        />
        {fieldErr(state, "name") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "name")}
          </p>
        )}
        {mode === "edit" && (
          <p className="text-xs text-muted-foreground">
            Renaming updates every existing shift in this area automatically.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="color">Colour (optional)</Label>
        <Input
          id="color"
          name="color"
          type="text"
          defaultValue={defaultValues?.color ?? ""}
          placeholder="#A33B2A"
          aria-invalid={!!fieldErr(state, "color")}
        />
        {fieldErr(state, "color") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "color")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
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
