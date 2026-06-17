"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { KioskNumpad } from "./_numpad";
import { KioskDashboard } from "./_dashboard";
import { LiveClock } from "~/components/LiveClock";
import { fmtSince, initials, ringColor } from "~/lib/kiosk/avatar";
import type { WhosHerePerson } from "~/lib/kiosk/whos-here";
import type { ScheduledPerson } from "~/lib/kiosk/scheduled";

export interface KioskPerson {
  id: string;
  name: string;
  image: string | null;
}

// A roster person merged with live status: on-shift "since" time (null = not
// in) and today's scheduled window (null = not scheduled here today).
type RosterRow = KioskPerson & {
  since: string | null;
  sched: { startsAt: string; endsAt: string } | null;
};

type Filter = "all" | "onshift" | "scheduled";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "onshift", label: "On shift" },
  { key: "scheduled", label: "Scheduled" },
];

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")];

// First-letter bucket for the alphabetical jump rail; anything that isn't an
// A–Z letter (digits, symbols) groups under "#".
function bucketOf(name: string): string {
  const c = name.trim()[0]?.toUpperCase() ?? "#";
  return c >= "A" && c <= "Z" ? c : "#";
}

// Kiosk sign-in: pick your name from the roster, then enter your PIN. The PIN
// is verified against the selected person only (see submitPinAction), so a
// shared PIN can never clock the wrong person.
export function KioskSignIn({
  people,
  tenantName,
  locationName,
  whosHere,
  scheduledToday,
  allowVisitors,
}: {
  people: KioskPerson[];
  tenantName: string;
  locationName: string;
  whosHere: WhosHerePerson[];
  scheduledToday: ScheduledPerson[];
  allowVisitors: boolean;
}) {
  const [selected, setSelected] = useState<KioskPerson | null>(null);
  // Chooser screen is shown first; the Employee button flips to the roster.
  const [mode, setMode] = useState<"choose" | "employee">("choose");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Weekday + date for the lime header band. Set in an effect so the server
  // render (which has no stable locale clock) doesn't mismatch on hydration.
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

  const sinceById = useMemo(
    () => new Map(whosHere.map((p) => [p.id, p.since])),
    [whosHere],
  );
  const schedById = useMemo(
    () => new Map(scheduledToday.map((s) => [s.id, s])),
    [scheduledToday],
  );

  const toRow = useMemo(
    () =>
      (p: KioskPerson): RosterRow => ({
        ...p,
        since: sinceById.get(p.id) ?? null,
        sched: schedById.get(p.id) ?? null,
      }),
    [sinceById, schedById],
  );

  // Apply the active filter first; search + grouping operate on this subset.
  const base = useMemo(
    () =>
      people.filter((p) => {
        if (filter === "onshift") return sinceById.has(p.id);
        if (filter === "scheduled") return schedById.has(p.id);
        return true;
      }),
    [people, filter, sinceById, schedById],
  );

  // Search results: on-shift first, then alphabetical. Only when searching.
  const searchRows = useMemo<RosterRow[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return base
      .filter((p) => p.name.toLowerCase().includes(needle))
      .map(toRow)
      .sort((a, b) => {
        if (!!a.since !== !!b.since) return a.since ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [base, q, toRow]);

  // Idle (no search) view: grouped alphabetically. Groups stay purely
  // alphabetical; status only colours the card, never the order.
  const groups = useMemo(() => {
    const byLetter = new Map<string, RosterRow[]>();
    for (const p of base) {
      const letter = bucketOf(p.name);
      const arr = byLetter.get(letter);
      if (arr) arr.push(toRow(p));
      else byLetter.set(letter, [toRow(p)]);
    }
    for (const arr of byLetter.values())
      arr.sort((a, b) => a.name.localeCompare(b.name));
    return byLetter;
  }, [base, toRow]);

  const jumpTo = (letter: string) => {
    const el = groupRefs.current[letter];
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop, behavior: "smooth" });
    }
  };

  if (selected) {
    return (
      <KioskNumpad
        key={selected.id}
        appUserId={selected.id}
        personName={selected.name}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (mode === "choose" && people.length > 0) {
    return (
      <KioskDashboard
        tenantName={tenantName}
        locationName={locationName}
        roster={people}
        whosHere={whosHere}
        allowVisitors={allowVisitors}
        onEmployee={() => setMode("employee")}
      />
    );
  }

  if (people.length === 0) {
    return (
      <p className="max-w-md text-center text-sm text-[#a89c8c]">
        No one has a kiosk PIN yet. Set one in the admin app under
        <span className="text-[#f4eee3]"> Employees → PIN</span> (or staff can
        set their own on <span className="text-[#f4eee3]">/app/welcome</span>).
      </p>
    );
  }

  const searching = q.trim().length > 0;
  const pick = (p: KioskPerson) => {
    setSelected(p);
    setQ("");
  };
  const emptyFilterLabel =
    filter === "onshift"
      ? "No one is on shift right now."
      : filter === "scheduled"
        ? "No one is scheduled here today."
        : "No one to show.";

  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-[#1a1512] shadow-xl">
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

      <div className="space-y-5 p-8">
        {/* Toolbar: back, instruction, on-shift status. */}
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setMode("choose");
              setQ("");
              setFilter("all");
            }}
            className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-[rgba(244,238,227,0.1)] px-4 py-2 text-sm font-medium text-[#f4eee3] transition hover:bg-[rgba(244,238,227,0.16)]"
          >
            ← Back
          </button>
          <p className="text-base font-semibold text-[#f4eee3]">
            Tap your name to clock in / out
          </p>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-[rgba(244,238,227,0.04)] px-3 py-1.5 font-mono text-sm text-[#a89c8c]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 animate-[sc-pulse_1.8s_infinite] rounded-full bg-[var(--live)] shadow-[0_0_0_4px_rgba(21,145,106,0.18)]"
            />
            {whosHere.length} on shift / {people.length}
          </span>
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count =
              f.key === "onshift"
                ? whosHere.length
                : f.key === "scheduled"
                  ? scheduledToday.length
                  : people.length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  active
                    ? "inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-ink)]"
                    : "inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-[#a89c8c] transition hover:bg-[rgba(244,238,227,0.08)]"
                }
              >
                {f.label}
                <span
                  className={`font-mono text-xs ${active ? "text-[var(--accent-ink)]/70" : "text-[#766b5e]"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="search"
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your name…"
          className="h-14 w-full rounded-xl border border-line bg-[rgba(244,238,227,0.05)] px-4 text-lg text-[#f4eee3] placeholder:text-[#766b5e] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />

        {/* Roster */}
        <div className="relative">
          <div
            ref={scrollRef}
            className="relative max-h-[55vh] overflow-y-auto pr-10"
          >
            {searching ? (
              searchRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-[#766b5e]">
                  No one matches “{q}”.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {searchRows.map((p) => (
                    <NameCard key={p.id} person={p} onSelect={pick} />
                  ))}
                </div>
              )
            ) : base.length === 0 ? (
              <p className="py-8 text-center text-sm text-[#766b5e]">
                {emptyFilterLabel}
              </p>
            ) : (
              LETTERS.map((letter) => {
                const rows = groups.get(letter);
                if (!rows || rows.length === 0) return null;
                return (
                  <div
                    key={letter}
                    ref={(el) => {
                      groupRefs.current[letter] = el;
                    }}
                  >
                    <h3 className="sticky top-0 z-10 bg-[#1a1512] py-2 font-mono text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                      {letter}
                    </h3>
                    <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {rows.map((p) => (
                        <NameCard key={p.id} person={p} onSelect={pick} />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* A–Z jump rail — only meaningful in the grouped (idle) view. */}
          {!searching && base.length > 0 ? (
            <nav
              aria-label="Jump to letter"
              className="absolute right-0 top-0 flex flex-col items-center font-mono text-xs"
            >
              {LETTERS.map((letter) => {
                const has = (groups.get(letter)?.length ?? 0) > 0;
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!has}
                    onClick={() => jumpTo(letter)}
                    className={
                      has
                        ? "flex h-[26px] w-7 items-center justify-center text-[#a89c8c] transition hover:text-[var(--accent)]"
                        : "flex h-[26px] w-7 items-center justify-center text-[#766b5e]/40"
                    }
                  >
                    {letter}
                  </button>
                );
              })}
            </nav>
          ) : null}
        </div>

        {/* Footer */}
        <div className="space-y-2 border-t border-line pt-5 text-center">
          <p className="text-sm text-[#766b5e]">
            Or scan your badge to clock in / out
          </p>
          {allowVisitors ? (
            <Link
              href="/kiosk/visitor"
              className="text-sm font-medium text-[#a89c8c] underline-offset-4 hover:text-[#f4eee3] hover:underline"
            >
              Visitor? Sign in here
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Vertical name card: ring-coloured avatar (or photo) with an on-shift status
// dot, the name, and a mono status line. Tapping it advances to the numpad.
function NameCard({
  person,
  onSelect,
}: {
  person: RosterRow;
  onSelect: (p: KioskPerson) => void;
}) {
  const onShift = !!person.since;
  const c = ringColor(person.id);
  return (
    <button
      type="button"
      onClick={() => onSelect(person)}
      className="flex min-h-[100px] flex-col items-center gap-2 rounded-xl border border-line bg-[rgba(244,238,227,0.04)] p-4 text-center transition hover:border-[var(--accent)] active:bg-[rgba(244,238,227,0.1)]"
    >
      <span
        className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white ${
          onShift ? "" : "opacity-50"
        }`}
        style={{ backgroundColor: c }}
      >
        {person.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.image}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          initials(person.name)
        )}
        <span
          className={`absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#1a1512] ${
            onShift ? "bg-[var(--live)]" : "bg-[#6b6052]"
          }`}
        />
      </span>
      <span className="line-clamp-2 text-sm font-medium text-[#f4eee3]">
        {person.name}
      </span>
      {onShift ? (
        <span className="font-mono text-xs tabular-nums text-[color-mix(in_srgb,var(--live)_60%,white)]">
          on shift · {fmtSince(person.since!)}
        </span>
      ) : person.sched ? (
        <span className="font-mono text-xs tabular-nums text-[#a89c8c]">
          scheduled {fmtSince(person.sched.startsAt)}–{fmtSince(person.sched.endsAt)}
        </span>
      ) : (
        <span className="font-mono text-xs text-[#766b5e]">not in</span>
      )}
    </button>
  );
}
