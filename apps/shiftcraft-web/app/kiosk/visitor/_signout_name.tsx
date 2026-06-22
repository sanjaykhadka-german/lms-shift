"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Sign-out name field: a free-text input (the typed name is what submits, as
// `visitorNameOut`) with a THEMED suggestion list of currently signed-in
// visitors dropping down right under the field. Replaces a native <datalist>,
// whose popup Android renders at the bottom of the screen above the keyboard.
export function SignOutNameInput({
  visitors,
  inputClassName,
}: {
  visitors: { name: string; sub: string }[];
  inputClassName: string;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = value.trim().toLowerCase();
    const base = needle
      ? visitors.filter((v) => v.name.toLowerCase().includes(needle))
      : visitors;
    return base.slice(0, 50);
  }, [visitors, value]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  return (
    <div className="relative" ref={wrapRef}>
      <input
        id="visitorNameOut"
        name="visitorNameOut"
        type="text"
        required
        maxLength={120}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Type your name"
        className={inputClassName}
      />
      {open && filtered.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[rgba(244,238,227,0.18)] bg-[#1a1512] py-1 shadow-xl">
          {filtered.map((v) => (
            <li key={`${v.name}::${v.sub}`}>
              <button
                type="button"
                onClick={() => {
                  setValue(v.name);
                  setOpen(false);
                }}
                className="block w-full touch-manipulation px-4 py-3 text-left transition hover:bg-[rgba(244,238,227,0.08)]"
              >
                <span className="block text-base text-[#f4eee3]">{v.name}</span>
                {v.sub ? (
                  <span className="block text-xs text-[#766b5e]">{v.sub}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
