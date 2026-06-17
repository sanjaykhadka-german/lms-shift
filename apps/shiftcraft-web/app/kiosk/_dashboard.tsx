"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveClock } from "~/components/LiveClock";
import { fmtSince, initials, ringColor } from "~/lib/kiosk/avatar";
import type { WhosHerePerson } from "~/lib/kiosk/whos-here";

interface RosterPerson {
  id: string;
  name: string;
  image: string | null;
}

/**
 * The kiosk landing "dashboard": company + location header with a live clock
 * and date, a vertical roster showing every employee and whether they're
 * currently on the clock, and a big call-to-action that reveals the
 * name-select sign-in flow.
 */
export function KioskDashboard({
  tenantName,
  locationName,
  roster,
  whosHere,
  allowVisitors,
  onStart,
}: {
  tenantName: string;
  locationName: string;
  roster: RosterPerson[];
  whosHere: WhosHerePerson[];
  allowVisitors: boolean;
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

  // Merge the roster with who's-on-the-clock so every employee is listed with
  // a clear status. On-shift people sort to the top, then alphabetical.
  const sinceById = new Map(whosHere.map((p) => [p.id, p.since]));
  const rows = roster
    .map((p) => ({ ...p, since: sinceById.get(p.id) ?? null }))
    .sort((a, b) => {
      if (!!a.since !== !!b.since) return a.since ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="w-full max-w-4xl space-y-7 rounded-2xl border border-[rgba(244,238,227,0.13)] bg-[#1a1512] p-8 shadow-xl sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-[#a89c8c]">
            {tenantName}
          </div>
          <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight text-[#f4eee3] sm:text-4xl">
            {locationName}
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <LiveClock variant="kiosk" className="text-3xl sm:text-4xl" />
          <div className="mt-1 text-sm text-[#a89c8c]">{dateLabel || " "}</div>
        </div>
      </header>

      <div>
        <div className="flex items-center gap-2 text-base">
          <span
            aria-hidden
            className="h-2.5 w-2.5 animate-[sc-pulse_1.8s_infinite] rounded-full bg-[var(--live)] shadow-[0_0_0_4px_rgba(21,145,106,0.18)]"
          />
          <span className="font-medium text-[#f4eee3]">On the clock now</span>
          <span className="font-mono text-sm text-[#a89c8c]">
            {whosHere.length} of {roster.length} staff
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-[#a89c8c]">
            No employees have a kiosk PIN yet.
          </p>
        ) : (
          <ul className="mt-4 max-h-[46vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((p) => {
              const onShift = !!p.since;
              const c = ringColor(p.id);
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-[rgba(244,238,227,0.1)] bg-[rgba(244,238,227,0.04)] px-4 py-3"
                >
                  <span
                    className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${
                      onShift ? "" : "opacity-50"
                    }`}
                    style={{ backgroundColor: c }}
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image}
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : (
                      initials(p.name)
                    )}
                    <span
                      className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#1a1512] ${
                        onShift ? "bg-[var(--live)]" : "bg-[#6b6052]"
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-medium text-[#f4eee3]">
                    {p.name}
                  </span>
                  {onShift ? (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-[color-mix(in_srgb,var(--live)_60%,white)]">
                      on shift · since {fmtSince(p.since!)}
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-xs text-[#766b5e]">
                      not clocked in
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-xl bg-[var(--accent)] px-6 py-6 text-lg font-semibold text-[var(--accent-ink)] shadow-sm transition hover:bg-[var(--accent-deep)] active:translate-y-px"
      >
        Tap your name or scan your badge to clock in / out
      </button>

      {allowVisitors ? (
        <div className="text-center">
          <Link
            href="/kiosk/visitor"
            className="text-sm font-medium text-[#a89c8c] underline-offset-4 hover:text-[#f4eee3] hover:underline"
          >
            Visitor? Sign in here
          </Link>
        </div>
      ) : null}
    </div>
  );
}
