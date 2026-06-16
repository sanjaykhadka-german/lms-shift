"use client";

import { useMemo, useState } from "react";
import { KioskNumpad } from "./_numpad";

export interface KioskPerson {
  id: string;
  name: string;
  image: string | null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Kiosk sign-in: pick your name from the roster, then enter your PIN. The PIN
// is verified against the selected person only (see submitPinAction), so a
// shared PIN can never clock the wrong person.
export function KioskSignIn({ people }: { people: KioskPerson[] }) {
  const [selected, setSelected] = useState<KioskPerson | null>(null);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.name.toLowerCase().includes(needle));
  }, [people, q]);

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

  if (people.length === 0) {
    return (
      <p className="max-w-md text-center text-sm text-[#a89c8c]">
        No one has a kiosk PIN yet. Set one in the admin app under
        <span className="text-[#f4eee3]"> Employees → PIN</span> (or staff can
        set their own on <span className="text-[#f4eee3]">/app/welcome</span>).
      </p>
    );
  }

  return (
    <div className="w-full max-w-2xl space-y-5">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#766b5e]">
          Tap your name
        </p>
      </div>
      <input
        type="search"
        inputMode="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your name…"
        className="h-12 w-full rounded-xl border border-[rgba(244,238,227,0.18)] bg-[rgba(244,238,227,0.05)] px-4 text-base text-[#f4eee3] placeholder:text-[#766b5e] focus:outline-none focus:ring-2 focus:ring-[rgba(244,238,227,0.25)]"
      />
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#766b5e]">
          No one matches “{q}”.
        </p>
      ) : (
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelected(p);
                setQ("");
              }}
              className="flex flex-col items-center gap-2 rounded-xl border border-[rgba(244,238,227,0.13)] bg-[rgba(244,238,227,0.04)] p-4 text-center active:bg-[rgba(244,238,227,0.1)]"
            >
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.image}
                  alt=""
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(244,238,227,0.12)] text-lg font-semibold text-[#f4eee3]">
                  {initials(p.name)}
                </span>
              )}
              <span className="line-clamp-2 text-sm font-medium text-[#f4eee3]">
                {p.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
