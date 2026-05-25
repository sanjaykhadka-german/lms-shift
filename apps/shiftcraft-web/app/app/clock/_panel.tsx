"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  breakEndAction,
  breakStartAction,
  clockInAction,
  clockOutAction,
  type PunchResult,
} from "./actions";

export type PanelStatus = "clocked_out" | "working" | "on_break";

interface Location {
  id: string;
  name: string;
}

interface Props {
  status: PanelStatus;
  /** ISO string of when the current segment started (null if clocked_out). */
  segmentStartedAtIso: string | null;
  locations: Location[];
  defaultLocationId: string | null;
  /** Sum of work ms before the current open segment (already-closed today). */
  baseWorkMs: number;
  /** Sum of break ms before the current open segment. */
  baseBreakMs: number;
}

function fmtClock(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function StatusPill({ status }: { status: PanelStatus }) {
  const styles: Record<PanelStatus, string> = {
    clocked_out: "bg-slate-500 text-white",
    working: "bg-emerald-600 text-white",
    on_break: "bg-amber-500 text-white",
  };
  const label: Record<PanelStatus, string> = {
    clocked_out: "Clocked out",
    working: "Working",
    on_break: "On break",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}

export function ClockPanel({
  status,
  segmentStartedAtIso,
  locations,
  defaultLocationId,
  baseWorkMs,
  baseBreakMs,
}: Props) {
  const [selectedLocationId, setSelectedLocationId] = useState<string>(
    defaultLocationId ?? "",
  );

  // AUDIT.md #7a — geofence-aware clock-in. We hold the GPS reading
  // in state; the punch forms thread it into hidden lat/lng fields
  // so the server can resolve to a geofenced location + tag the
  // event with source='geofence'. Pre-fill the dropdown for UX, but
  // the server re-derives so a tampered client can't lie.
  const [gpsCoords, setGpsCoords] = useState<{
    lat: number;
    lng: number;
    accuracyM: number;
    at: number;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    | { kind: "idle" }
    | { kind: "requesting" }
    | { kind: "ok"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const gpsAvailable =
    typeof navigator !== "undefined" && "geolocation" in navigator;

  function useMyLocation() {
    if (!gpsAvailable) return;
    setGpsStatus({ kind: "requesting" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          at: Date.now(),
        });
        setGpsStatus({
          kind: "ok",
          message: `Captured GPS (±${Math.round(pos.coords.accuracy)}m). The server will match it to a geofenced location at punch time.`,
        });
      },
      (err) => {
        setGpsStatus({
          kind: "error",
          message:
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied — falling back to manual location."
              : `Couldn't read location (${err.message}). Falling back to manual.`,
        });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }

  // Tick the live elapsed display.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const segmentStartedAt = segmentStartedAtIso
    ? new Date(segmentStartedAtIso)
    : null;
  const liveMs = segmentStartedAt ? Date.now() - segmentStartedAt.getTime() : 0;
  const workMs = status === "working" ? baseWorkMs + liveMs : baseWorkMs;
  const breakMs = status === "on_break" ? baseBreakMs + liveMs : baseBreakMs;

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <StatusPill status={status} />
          {segmentStartedAt && (
            <p className="text-xs text-muted-foreground">
              Since{" "}
              {segmentStartedAt.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div className="flex items-baseline gap-4 font-mono">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Worked today
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmtClock(workMs)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Break
            </div>
            <div className="text-lg tabular-nums text-muted-foreground">
              {fmtClock(breakMs)}
            </div>
          </div>
        </div>
      </div>

      {locations.length > 0 && (
        <div className="mt-6 space-y-2">
          <label
            htmlFor="locationId"
            className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Location (optional)
          </label>
          <select
            id="locationId"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] sm:w-72"
          >
            <option value="">— No location —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {gpsAvailable ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={useMyLocation}
                disabled={gpsStatus.kind === "requesting"}
              >
                {gpsStatus.kind === "requesting"
                  ? "Finding you…"
                  : gpsCoords
                    ? "Refresh location"
                    : "Use my location"}
              </Button>
              {gpsStatus.kind === "ok" && (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {gpsStatus.message}
                </span>
              )}
              {gpsStatus.kind === "error" && (
                <span className="text-amber-700 dark:text-amber-400">
                  {gpsStatus.message}
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "clocked_out" && (
          <PunchForm
            action={clockInAction}
            label="Clock in"
            locationId={selectedLocationId}
            gpsCoords={gpsCoords}
            variant="primary"
          />
        )}
        {status === "working" && (
          <>
            <PunchForm
              action={breakStartAction}
              label="Start break"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              variant="secondary"
            />
            <PunchForm
              action={clockOutAction}
              label="Clock out"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              variant="destructive"
            />
          </>
        )}
        {status === "on_break" && (
          <>
            <PunchForm
              action={breakEndAction}
              label="Resume work"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              variant="primary"
            />
            <PunchForm
              action={clockOutAction}
              label="Clock out"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              variant="destructive"
            />
          </>
        )}
      </div>
    </section>
  );
}

function PunchForm({
  action,
  label,
  locationId,
  gpsCoords,
  variant,
}: {
  action: (
    _prev: PunchResult | undefined,
    formData: FormData,
  ) => Promise<PunchResult>;
  label: string;
  locationId: string;
  gpsCoords: { lat: number; lng: number; accuracyM: number; at: number } | null;
  variant: "primary" | "secondary" | "destructive";
}) {
  const [state, formAction, pending] = useActionState<
    PunchResult | undefined,
    FormData
  >(action, undefined);

  // Map our semantic intent onto the Button variants that exist in
  // components/ui/button.tsx (default | outline | ghost | link). The
  // destructive intent is approximated with an outline + a destructive
  // text colour — adding a dedicated variant is out of scope for now.
  const buttonVariant: "default" | "outline" =
    variant === "primary" ? "default" : "outline";
  const extraClass =
    variant === "destructive"
      ? "text-[color:var(--destructive)] border-[color:var(--destructive)]/40 hover:bg-[color:var(--destructive)]/10"
      : "";

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="locationId" value={locationId} />
      {gpsCoords ? (
        <>
          <input type="hidden" name="lat" value={gpsCoords.lat.toString()} />
          <input type="hidden" name="lng" value={gpsCoords.lng.toString()} />
        </>
      ) : null}
      <Button
        type="submit"
        disabled={pending}
        variant={buttonVariant}
        className={extraClass}
      >
        {pending ? "Recording…" : label}
      </Button>
      {state?.status === "error" && (
        <p className="text-xs text-[color:var(--destructive)]">
          {state.message}
        </p>
      )}
    </form>
  );
}
