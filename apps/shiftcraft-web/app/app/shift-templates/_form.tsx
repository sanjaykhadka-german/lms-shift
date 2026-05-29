"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createShiftTemplateAction,
  updateShiftTemplateAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

interface Location {
  id: string;
  name: string;
}

interface Defaults {
  name: string;
  locationId: string;
  role: string;
  startsAt: string; // "HH:MM"
  endsAt: string;
  defaultNotes: string | null;
}

interface Props {
  mode: "create" | "edit";
  templateId?: string;
  defaultValues?: Defaults;
  locations: Location[];
}

function fieldErr(state: FormState, key: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[key]?.[0] ?? null;
}

export function ShiftTemplateForm({
  mode,
  templateId,
  defaultValues,
  locations,
}: Props) {
  const action =
    mode === "edit" && templateId
      ? updateShiftTemplateAction.bind(null, templateId)
      : createShiftTemplateAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Save template";
  const pendingLabel = mode === "edit" ? "Saving…" : "Saving…";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Saturday morning butcher"
          required
          aria-invalid={!!fieldErr(state, "name")}
        />
        {fieldErr(state, "name") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "name")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="locationId">Location</Label>
        <select
          id="locationId"
          name="locationId"
          defaultValue={defaultValues?.locationId ?? ""}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="" disabled>
            Pick a location
          </option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {fieldErr(state, "locationId") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "locationId")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Input
          id="role"
          name="role"
          defaultValue={defaultValues?.role ?? ""}
          placeholder="e.g. Butcher"
          required
          aria-invalid={!!fieldErr(state, "role")}
        />
        {fieldErr(state, "role") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "role")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="startsAt">Start (time of day)</Label>
        <Input
          id="startsAt"
          name="startsAt"
          type="time"
          step={900}
          defaultValue={defaultValues?.startsAt ?? "09:00"}
          required
        />
        {fieldErr(state, "startsAt") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "startsAt")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endsAt">End (time of day)</Label>
        <Input
          id="endsAt"
          name="endsAt"
          type="time"
          step={900}
          defaultValue={defaultValues?.endsAt ?? "17:00"}
          required
        />
        {fieldErr(state, "endsAt") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "endsAt")}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="defaultNotes">Default notes (optional)</Label>
        <textarea
          id="defaultNotes"
          name="defaultNotes"
          rows={3}
          defaultValue={defaultValues?.defaultNotes ?? ""}
          placeholder="Pre-fills the Notes field on every shift made from this template."
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
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
