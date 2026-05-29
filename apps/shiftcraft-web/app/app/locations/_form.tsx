"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  createLocationAction,
  updateLocationAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

const COMMON_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Hobart",
  "Australia/Darwin",
  "Pacific/Auckland",
  "UTC",
];

interface Props {
  mode: "create" | "edit";
  locationId?: string;
  defaultValues?: {
    name: string;
    timezone: string;
    address: string | null;
    color: string | null;
    lat: number | null;
    lng: number | null;
    geofenceRadiusM: number | null;
    dailyWageBudget: string | null;
  };
}

export function LocationForm({ mode, locationId, defaultValues }: Props) {
  const action =
    mode === "edit" && locationId
      ? updateLocationAction.bind(null, locationId)
      : createLocationAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const submitLabel = mode === "edit" ? "Save changes" : "Add location";
  const pendingLabel = mode === "edit" ? "Saving…" : "Adding…";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultValues?.name ?? ""}
          placeholder="e.g. Brunswick Store"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.name}
        />
        {state.status === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <select
          id="timezone"
          name="timezone"
          defaultValue={defaultValues?.timezone ?? "Australia/Sydney"}
          required
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.timezone && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.timezone[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="address">Address (optional)</Label>
        <Input
          id="address"
          name="address"
          defaultValue={defaultValues?.address ?? ""}
          placeholder="123 Lygon St, Brunswick VIC 3056"
        />
        {state.status === "error" && state.fieldErrors?.address && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.address[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="color">Accent colour (optional)</Label>
        <div className="flex items-center gap-2">
          <input
            id="color"
            name="color"
            type="color"
            defaultValue={defaultValues?.color ?? "#7c1f1f"}
            className="h-9 w-12 cursor-pointer rounded-md border border-[color:var(--input)] bg-transparent p-1"
          />
          <span className="text-xs text-muted-foreground">
            Used to colour-code this location on the schedule and dashboard.
          </span>
        </div>
        {state.status === "error" && state.fieldErrors?.color && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.color[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="dailyWageBudget">Daily wage budget (AUD, optional)</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            id="dailyWageBudget"
            name="dailyWageBudget"
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            defaultValue={defaultValues?.dailyWageBudget ?? ""}
            placeholder="e.g. 1200"
            className="max-w-[12rem]"
            aria-invalid={
              state.status === "error" && !!state.fieldErrors?.dailyWageBudget
            }
          />
          <span className="text-xs text-muted-foreground">
            per day. Leave blank for no budget.
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The schedule and auto-fill warn when a day&rsquo;s projected wages
          (shift hours &times; each assignee&rsquo;s rate) exceed this. A single
          figure applies to every day of the week.
        </p>
        {state.status === "error" && state.fieldErrors?.dailyWageBudget && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.dailyWageBudget[0]}
          </p>
        )}
      </div>

      <fieldset className="sm:col-span-2 space-y-3 rounded-md border border-border p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Geofence (Phase 2 #7a)
        </legend>
        <p className="text-xs text-muted-foreground">
          Set lat/lng + radius to let employees clock in from a phone
          when they&rsquo;re physically near this site. Leave any field
          blank to disable geofence for this location. Quickest way to
          grab coordinates: open Google Maps, right-click the site
          pin, copy the first two numbers.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="lat">Latitude</Label>
            <Input
              id="lat"
              name="lat"
              type="number"
              inputMode="decimal"
              step="0.0000001"
              min={-90}
              max={90}
              defaultValue={defaultValues?.lat?.toString() ?? ""}
              placeholder="-37.7660"
            />
            {state.status === "error" && state.fieldErrors?.lat && (
              <p className="text-xs text-[color:var(--destructive)]">
                {state.fieldErrors.lat[0]}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lng">Longitude</Label>
            <Input
              id="lng"
              name="lng"
              type="number"
              inputMode="decimal"
              step="0.0000001"
              min={-180}
              max={180}
              defaultValue={defaultValues?.lng?.toString() ?? ""}
              placeholder="144.9620"
            />
            {state.status === "error" && state.fieldErrors?.lng && (
              <p className="text-xs text-[color:var(--destructive)]">
                {state.fieldErrors.lng[0]}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="geofenceRadiusM">Radius (m)</Label>
            <Input
              id="geofenceRadiusM"
              name="geofenceRadiusM"
              type="number"
              inputMode="numeric"
              step={1}
              min={1}
              max={5000}
              defaultValue={defaultValues?.geofenceRadiusM?.toString() ?? ""}
              placeholder="100"
            />
            {state.status === "error" && state.fieldErrors?.geofenceRadiusM && (
              <p className="text-xs text-[color:var(--destructive)]">
                {state.fieldErrors.geofenceRadiusM[0]}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
