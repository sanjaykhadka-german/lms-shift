import type { ScClockEventType } from "@tracey/db";

// Pure clock helpers — NO `server-only`, NO DB. Split out of ./clock so they
// can be imported by code that runs OUTSIDE the Next bundler (the hourly cron
// in scripts/sweep-stale-clock-outs.ts, via ~/lib/clock-sweep). `server-only`
// is a Next-provided virtual module that fails to resolve under plain `tsx`,
// so anything in the cron's import chain must avoid it. ./clock re-exports
// everything here, so existing `~/lib/clock` importers are unaffected.

export type ClockStatus = "clocked_out" | "working" | "on_break";

// ─── Date helpers (Mon-start week) ─────────────────────────────────────────

export function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - dow);
  return r;
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse an ISO date (YYYY-MM-DD) in local TZ at midnight. Invalid → null. */
export function parseIsoDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtHours(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// ─── Transition guard ─────────────────────────────────────────────────────
//
// The DB can't enforce "valid next event" with a CHECK constraint because
// the validity depends on the *stream's* current state, not on the row
// being inserted. Both the per-user /app/clock surface and the on-premise
// kiosk gate on this same guard so the rule is stated once.

export function stateFor(
  prev: ScClockEventType | undefined,
): ClockStatus {
  switch (prev) {
    case "in":
    case "break_end":
      return "working";
    case "break_start":
      return "on_break";
    case "out":
    case undefined:
      return "clocked_out";
    default:
      return "clocked_out";
  }
}

/**
 * Returns an error string if `next` would be an invalid transition from
 * `prev`, or null when the move is allowed. The shape mirrors the original
 * inline check in app/clock/actions.ts — keeping the error copy stable so
 * existing tests pass.
 */
export function validateTransition(
  prev: ScClockEventType | undefined,
  next: ScClockEventType,
): string | null {
  const state = stateFor(prev);
  switch (next) {
    case "in":
      return state === "clocked_out" ? null : "You're already clocked in.";
    case "break_start":
      return state === "working"
        ? null
        : "Start a shift before taking a break.";
    case "break_end":
      return state === "on_break" ? null : "You're not on a break.";
    case "out":
      return state === "working" || state === "on_break"
        ? null
        : "You're not clocked in.";
    default:
      return "Unknown action.";
  }
}
