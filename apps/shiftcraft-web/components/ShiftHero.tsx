"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "~/components/Avatar";
import { Button } from "~/components/ui/button";

interface Props {
  name: string;
  email: string;
  image: string | null;
  /** Scheduled shift window (ms). null when there is no shift today. */
  shiftStartMs: number | null;
  shiftEndMs: number | null;
  role: string | null;
  locationName: string | null;
  /** Actual open clock-in (ms). null when the user is not clocked in. */
  clockedInAtMs: number | null;
}

const RING_R = 58;
const RING_C = 2 * Math.PI * RING_R; // ≈ 364.42
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Live shift hero. The only ticking UI on the dashboard. We mirror LiveClock's
 * mount guard: `now` starts null so the server-rendered first paint is static
 * (no Date.now() during SSR → no hydration mismatch), then an effect kicks off
 * a 1s interval.
 *
 * - Clocked in  → live "On shift", elapsed measured from the open clock-in.
 * - Shift today but not clocked in → scheduled window at rest (no pulse).
 * - Neither     → empty state with a Start-unscheduled-shift CTA.
 */
export function ShiftHero({
  name,
  email,
  image,
  shiftStartMs,
  shiftEndMs,
  role,
  locationName,
  clockedInAtMs,
}: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hasShift = shiftStartMs != null && shiftEndMs != null;
  const isLive = clockedInAtMs != null;
  const isEmpty = !hasShift && !isLive;

  // Ring total: the planned shift length when known, else an 8h reference.
  const total = hasShift ? shiftEndMs! - shiftStartMs! : EIGHT_HOURS_MS;

  let elapsed = 0;
  if (now != null) {
    if (isLive) {
      elapsed = clamp(now - clockedInAtMs!, 0, total);
    } else if (hasShift) {
      elapsed = clamp(now - shiftStartMs!, 0, total);
    }
  }

  const progress = total > 0 ? clamp(elapsed / total, 0, 1) : 0;
  const pct = Math.round(progress * 100);
  const remaining = Math.max(0, total - elapsed);
  const offset = RING_C * (1 - (now == null ? 0 : progress));

  const inMs = clockedInAtMs ?? shiftStartMs;
  const outMs = shiftEndMs;

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
      {/* Progress ring */}
      <div className="relative mx-auto h-[140px] w-[140px] shrink-0 sm:mx-0">
        <svg
          viewBox="0 0 140 140"
          className="h-full w-full -rotate-90"
          aria-hidden
        >
          <circle
            cx="70"
            cy="70"
            r={RING_R}
            fill="none"
            stroke="var(--paper-2)"
            strokeWidth="9"
          />
          {!isEmpty ? (
            <circle
              cx="70"
              cy="70"
              r={RING_R}
              fill="none"
              stroke="var(--live)"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={offset}
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-2xl font-semibold text-ink">
            {isEmpty ? "—" : `${pct}%`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            of shift
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-3">
          <Avatar name={name} email={email} image={image} sizeClass="h-11 w-11" />
          <div className="min-w-0">
            <div className="truncate font-semibold text-ink">{name}</div>
            {isLive ? (
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-live">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 animate-[sc-pulse_1.8s_infinite] rounded-full bg-current"
                />
                On shift{role ? ` — ${role}` : ""}
              </div>
            ) : isEmpty ? (
              <div className="text-[13px] text-ink-3">
                No scheduled shifts today
              </div>
            ) : (
              <div className="truncate text-[13px] text-ink-2">
                {role ?? "Scheduled"}
                {locationName ? ` · ${locationName}` : ""}
              </div>
            )}
          </div>
        </div>

        {isEmpty ? (
          <Button asChild>
            <Link href="/app/clock">Start unscheduled shift</Link>
          </Button>
        ) : (
          <>
            <div className="font-mono text-4xl font-semibold tabular-nums text-ink">
              {now == null ? "--:--:--" : fmtElapsed(elapsed)}
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3">
              {inMs != null ? <span>In {fmtClock(inMs)}</span> : null}
              {outMs != null ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{fmtElapsed(remaining)} to go</span>
                  <span aria-hidden>·</span>
                  <span>Out {fmtClock(outMs)}</span>
                </>
              ) : null}
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-paper-2">
              <div
                className="h-full rounded-full bg-[var(--accent)]"
                style={{
                  width: `${now == null ? 0 : pct}%`,
                  transition: "width 1s linear",
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
