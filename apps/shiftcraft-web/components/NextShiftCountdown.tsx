"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { countdownFor, type CountdownTone } from "~/lib/next-shift-format";
import { fmtShortDateTime, fmtTime24 } from "~/lib/date-format";

interface Props {
  shiftId: string;
  startsAtIso: string;
  endsAtIso: string;
  role: string;
  locationName: string | null;
  locationColor: string | null;
}

const TONE_BG: Record<CountdownTone, string> = {
  upcoming: "border-[color-mix(in_srgb,var(--accent-deep)_30%,transparent)] bg-card",
  imminent: "border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)]",
  working: "border-[color-mix(in_srgb,var(--live)_50%,transparent)] bg-[color-mix(in_srgb,var(--live)_10%,transparent)]",
  finished: "border-line bg-card",
};

const TONE_CHIP: Record<CountdownTone, string> = {
  upcoming: "bg-[var(--accent-deep)] text-[var(--accent-ink)]",
  imminent: "bg-[var(--warn)] text-white",
  working: "bg-[var(--live)] text-white",
  finished: "bg-[var(--ink-3)] text-white",
};

function fmtRange(startsAt: Date, endsAt: Date): string {
  const sameDay = startsAt.toDateString() === endsAt.toDateString();
  const start = fmtShortDateTime(startsAt);
  if (sameDay) {
    return `${start} – ${fmtTime24(endsAt)}`;
  }
  return `${start} → ${fmtShortDateTime(endsAt)}`;
}

/**
 * Live-ticking countdown card for the dashboard. Pure client side: we
 * recompute the human label each render from the immutable ISO inputs
 * and re-render every second when we're under an hour, every minute
 * otherwise.
 *
 * If the formatter returns null (shift finished > 1h ago), the card
 * unmounts itself by returning null.
 */
export function NextShiftCountdown({
  shiftId,
  startsAtIso,
  endsAtIso,
  role,
  locationName,
  locationColor,
}: Props) {
  const startsAt = new Date(startsAtIso);
  const endsAt = new Date(endsAtIso);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    // Tick every second while we're close to or inside the shift; once
    // we're further than ~1 hour away tick every 30 seconds to keep
    // background load low.
    const distMs = Math.abs(now.getTime() - startsAt.getTime());
    const intervalMs = distMs < 60 * 60 * 1000 ? 1000 : 30 * 1000;
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
    // Intentionally re-run on `now` so the interval cadence adapts as
    // the boundary approaches; the cleanup-then-reschedule pattern is
    // cheap.
  }, [now, startsAt]);

  const result = countdownFor(now, startsAt, endsAt);
  if (!result) return null;

  return (
    <Link
      href={`/app/my-shifts`}
      className={`block rounded-lg border-2 p-5 shadow-sm transition-colors hover:bg-muted/40 ${TONE_BG[result.tone]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TONE_CHIP[result.tone]}`}
            >
              {result.headline}
            </span>
            {locationColor && (
              <span
                aria-hidden
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ backgroundColor: locationColor }}
              />
            )}
          </div>
          <div className="text-2xl font-semibold tracking-tight tabular-nums">
            {result.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {role}
            {locationName ? ` @ ${locationName}` : ""} · {fmtRange(startsAt, endsAt)}
          </div>
        </div>
      </div>
    </Link>
  );
}
