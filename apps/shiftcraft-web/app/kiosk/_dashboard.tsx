"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveClock } from "~/components/LiveClock";
import type { WhosHerePerson } from "~/lib/kiosk/whos-here";

interface RosterPerson {
  id: string;
  name: string;
  image: string | null;
}

/**
 * The kiosk landing "chooser": company + location header with a live clock, a
 * one-line "on the clock now" summary, and two big buttons — Employee (reveals
 * the name-select roster) or Visitor (jumps to the visitor sign-in form).
 */
export function KioskDashboard({
  tenantName,
  locationName,
  roster,
  whosHere,
  allowVisitors,
  onEmployee,
}: {
  tenantName: string;
  locationName: string;
  roster: RosterPerson[];
  whosHere: WhosHerePerson[];
  allowVisitors: boolean;
  onEmployee: () => void;
}) {
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    setDateLabel(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    );
  }, []);

  return (
    <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-[#1a1512] shadow-xl">
      {/* Lime header band: tenant + location on the left, clock + date right. */}
      <header className="flex items-start justify-between gap-4 bg-[var(--accent)] px-8 py-6 text-[var(--accent-ink)]">
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--accent-ink)]/70">
            {tenantName}
          </div>
          <h1 className="mt-1 truncate font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {locationName}
          </h1>
        </div>
        <div className="shrink-0 text-right">
          {/* Dark inset chip — LiveClock renders light digits + lime seconds,
              which would be illegible directly on the lime band. */}
          <div className="inline-block rounded-xl bg-[#17130f] px-4 py-2">
            <LiveClock variant="kiosk" className="text-3xl sm:text-4xl" />
          </div>
          <div className="mt-1.5 text-sm font-medium text-[var(--accent-ink)]/70">
            {dateLabel || " "}
          </div>
        </div>
      </header>

      <div className="space-y-7 p-8 sm:p-10">
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

        <div
          className={`grid gap-4 ${allowVisitors ? "sm:grid-cols-2" : "grid-cols-1"}`}
        >
          <button
            type="button"
            onClick={onEmployee}
            className="flex min-h-[88px] flex-col items-center justify-center rounded-xl bg-[var(--accent)] px-6 py-6 text-center text-lg font-semibold text-[var(--accent-ink)] shadow-sm transition hover:bg-[var(--accent-deep)] active:translate-y-px"
          >
            Employee
            <span className="mt-0.5 text-sm font-medium text-[var(--accent-ink)]/70">
              Clock in / out
            </span>
          </button>

          {allowVisitors ? (
            <Link
              href="/kiosk/visitor"
              className="flex min-h-[88px] flex-col items-center justify-center rounded-xl border border-line bg-[rgba(244,238,227,0.1)] px-6 py-6 text-center text-lg font-semibold text-[#f4eee3] transition hover:bg-[rgba(244,238,227,0.16)] active:translate-y-px"
            >
              Visitor
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
