"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Eyebrow } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { SelfieCapture } from "~/components/SelfieCapture";
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

const STATUS_BADGE: Record<
  PanelStatus,
  { variant: "live" | "warn" | "neutral"; label: string }
> = {
  clocked_out: { variant: "neutral", label: "Clocked out" },
  working: { variant: "live", label: "Working" },
  on_break: { variant: "warn", label: "On break" },
};

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

  // AUDIT.md #7b — optional selfie capture. dataUrl held in state +
  // threaded into each PunchForm's hidden "selfie" input. The "skip"
  // sentinel tells the server to write a denied-status photo row so
  // the timesheet audit pane reflects the user's choice.
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [showSelfie, setShowSelfie] = useState(false);
  const cameraAvailable =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices !== "undefined" &&
    typeof navigator.mediaDevices.getUserMedia === "function";

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

  const badge = STATUS_BADGE[status];

  return (
    <section className="rounded-[var(--r-lg)] border border-line bg-[var(--paper)] p-6 shadow-[var(--shadow-sm)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Badge variant={badge.variant} dot={status === "working"}>
            {badge.label}
          </Badge>
          {segmentStartedAt && (
            <p className="font-mono text-[11px] text-ink-3">
              Since{" "}
              {segmentStartedAt.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <div className="text-right">
          <Eyebrow>Break</Eyebrow>
          <div className="mt-1 font-mono text-2xl tabular-nums text-ink-2">
            {fmtClock(breakMs)}
          </div>
        </div>
      </div>

      {/* Hero timer — the live "worked today" total, big mono numerals. */}
      <div className="mt-6">
        <Eyebrow>Worked today</Eyebrow>
        <div
          className={cn(
            "mt-1 font-mono text-[clamp(3rem,12vw,4.5rem)] font-semibold leading-none tabular-nums tracking-[-0.02em]",
            status === "working"
              ? "text-ink"
              : status === "on_break"
                ? "text-[var(--warn)]"
                : "text-ink-3",
          )}
        >
          {fmtClock(workMs)}
        </div>
      </div>

      {locations.length > 0 && (
        <div className="mt-6 space-y-2">
          <label
            htmlFor="locationId"
            className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3"
          >
            Location (optional)
          </label>
          <select
            id="locationId"
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="mt-1 flex h-10 w-full rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] sm:w-72"
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
                <span className="text-[var(--live)]">{gpsStatus.message}</span>
              )}
              {gpsStatus.kind === "error" && (
                <span className="text-[var(--warn)]">{gpsStatus.message}</span>
              )}
            </div>
          ) : null}

          {cameraAvailable && (status === "clocked_out" || status === "working") ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowSelfie(true)}
              >
                {selfieDataUrl && selfieDataUrl !== "skip"
                  ? "Retake selfie"
                  : "Add selfie"}
              </Button>
              {selfieDataUrl && selfieDataUrl !== "skip" ? (
                <>
                  <span className="text-[var(--live)]">
                    Selfie attached. Submitted with the next punch.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelfieDataUrl(null)}
                    className="text-ink-3 hover:text-ink hover:underline"
                  >
                    Clear
                  </button>
                </>
              ) : selfieDataUrl === "skip" ? (
                <span className="text-[var(--warn)]">
                  Skipped — the punch will record selfie as denied.
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {showSelfie ? (
        <SelfieCapture
          onCapture={(dataUrl) => {
            setSelfieDataUrl(dataUrl);
            setShowSelfie(false);
          }}
          onSkip={() => {
            setSelfieDataUrl("skip");
            setShowSelfie(false);
          }}
          onCancel={() => setShowSelfie(false)}
        />
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "clocked_out" && (
          <PunchForm
            action={clockInAction}
            label="Clock in"
            locationId={selectedLocationId}
            gpsCoords={gpsCoords}
            selfieDataUrl={selfieDataUrl}
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
              selfieDataUrl={selfieDataUrl}
              variant="secondary"
            />
            <PunchForm
              action={clockOutAction}
              label="Clock out"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              selfieDataUrl={selfieDataUrl}
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
              selfieDataUrl={selfieDataUrl}
              variant="primary"
            />
            <PunchForm
              action={clockOutAction}
              label="Clock out"
              locationId={selectedLocationId}
              gpsCoords={gpsCoords}
              selfieDataUrl={selfieDataUrl}
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
  selfieDataUrl,
  variant,
}: {
  action: (
    _prev: PunchResult | undefined,
    formData: FormData,
  ) => Promise<PunchResult>;
  label: string;
  locationId: string;
  gpsCoords: { lat: number; lng: number; accuracyM: number; at: number } | null;
  /** Either a "data:image/jpeg;base64,..." dataUrl, the literal "skip"
   *  sentinel (user opened then dismissed the selfie modal), or null
   *  (no selfie attempted — server tags selfie_status='unavailable'
   *  for in/out punches and skips the photo row for breaks). */
  selfieDataUrl: string | null;
  variant: "primary" | "secondary" | "destructive";
}) {
  const [state, formAction, pending] = useActionState<
    PunchResult | undefined,
    FormData
  >(action, undefined);

  // Map our semantic intent onto the Workforce Studio Button variants:
  // primary → lime fill, secondary → hairline outline, destructive →
  // danger fill (clock-out).
  const buttonVariant: "default" | "outline" | "destructive" =
    variant === "primary"
      ? "default"
      : variant === "destructive"
        ? "destructive"
        : "outline";

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="locationId" value={locationId} />
      {gpsCoords ? (
        <>
          <input type="hidden" name="lat" value={gpsCoords.lat.toString()} />
          <input type="hidden" name="lng" value={gpsCoords.lng.toString()} />
        </>
      ) : null}
      {selfieDataUrl ? (
        <input type="hidden" name="selfie" value={selfieDataUrl} />
      ) : null}
      <Button type="submit" disabled={pending} variant={buttonVariant} size="lg">
        {pending ? "Recording…" : label}
      </Button>
      {state?.status === "error" && (
        <p className="text-xs text-[var(--danger)]">{state.message}</p>
      )}
    </form>
  );
}
