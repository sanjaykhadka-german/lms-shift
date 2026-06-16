"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveClock } from "~/components/LiveClock";
import type { WhosHerePerson } from "~/lib/kiosk/whos-here";

// Stable per-person ring colour, hashed from the user id so the same person
// always gets the same colour. Palette mirrors the dashboard mock.
const RING_PALETTE = [
  "#c0492f",
  "#9a8a5c",
  "#d98324",
  "#3f7d6e",
  "#8a5a8c",
  "#5a6e8c",
];

function ringColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return RING_PALETTE[h % RING_PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function fmtSince(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The kiosk landing "dashboard": company + location header with a live clock
 * and date, an "on the clock now" strip of avatars, and a big call-to-action
 * that reveals the name-select sign-in flow.
 */
export function KioskDashboard({
  tenantName,
  locationName,
  whosHere,
  rosterCount,
  onStart,
}: {
  tenantName: string;
  locationName: string;
  whosHere: WhosHerePerson[];
  rosterCount: number;
  onStart: () => void;
}) {
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    setDateLabel(
      new Date().toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
    );
  }, []);

  return (
    <div className="w-full max-w-3xl space-y-7 rounded-2xl border border-[rgba(244,238,227,0.13)] bg-[var(--paper)] p-7 shadow-xl sm:p-9">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#766b5e]">
            {tenantName}
          </div>
          <h1 className="mt-0.5 truncate font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {locationName}
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <LiveClock variant="kiosk" className="text-2xl sm:text-3xl" />
          <div className="mt-0.5 text-xs text-[#766b5e]">{dateLabel || " "}</div>
        </div>
      </header>

      <div>
        <div className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className="h-2 w-2 animate-[sc-pulse_1.8s_infinite] rounded-full bg-[var(--live)] shadow-[0_0_0_4px_rgba(21,145,106,0.18)]"
          />
          <span className="font-medium text-[#f4eee3]">On the clock now</span>
          <span className="font-mono text-xs text-[#766b5e]">
            {whosHere.length} of {rosterCount} staff
          </span>
        </div>

        {whosHere.length === 0 ? (
          <p className="mt-4 text-sm text-[#766b5e]">
            Nobody is clocked in here yet.
          </p>
        ) : (
          <ul className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {whosHere.map((p) => {
              const c = ringColor(p.id);
              return (
                <li
                  key={p.id}
                  className="flex w-24 shrink-0 flex-col items-center gap-2 text-center"
                >
                  <div className="relative">
                    <span
                      className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-semibold text-white"
                      style={{ backgroundColor: c }}
                    >
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image}
                          alt=""
                          width={64}
                          height={64}
                          className="h-16 w-16 rounded-full object-cover"
                        />
                      ) : (
                        initials(p.name)
                      )}
                    </span>
                    <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-[var(--paper)] bg-[var(--live)]" />
                  </div>
                  <span className="line-clamp-1 w-full text-xs font-medium text-[#f4eee3]">
                    {p.name}
                  </span>
                  <span className="font-mono text-[10px] text-[#766b5e]">
                    since {fmtSince(p.since)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-xl bg-[var(--accent)] px-6 py-5 text-base font-semibold text-[var(--accent-ink)] shadow-sm transition hover:bg-[var(--accent-deep)] active:translate-y-px"
      >
        Tap your name or scan your badge to clock in / out
      </button>

      <div className="text-center">
        <Link
          href="/kiosk/visitor"
          className="text-xs font-medium text-[#a89c8c] underline-offset-4 hover:text-[#f4eee3] hover:underline"
        >
          Visitor? Sign in here
        </Link>
      </div>
    </div>
  );
}
