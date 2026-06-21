"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Themed, searchable employee picker for the visitor form. The native <select>
// popup can't be styled (the OS draws it), so this is a custom combobox: a
// search input plus a dark dropdown list, writing the chosen employee id into a
// hidden input named `visitingEmployeeId` so it submits with the form.
export function EmployeePicker({
  employees,
  value,
  onChange,
  inputClassName,
}: {
  employees: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  inputClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedName = employees.find((e) => e.id === value)?.name ?? "";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? employees.filter((e) => e.name.toLowerCase().includes(needle))
      : employees;
    return base.slice(0, 50);
  }, [employees, q]);

  // Close when clicking/tapping outside so the dropdown doesn't linger.
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
      <input type="hidden" name="visitingEmployeeId" value={value} />
      <input
        id="visitingEmployeeId"
        type="text"
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        value={open ? q : selectedName}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          if (value) onChange("");
        }}
        placeholder="Search employee…"
        className={inputClassName}
      />
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[rgba(244,238,227,0.18)] bg-[#1a1512] py-1 shadow-xl">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[#766b5e]">
              No matching employee.
            </li>
          ) : (
            filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(e.id);
                    setOpen(false);
                    setQ("");
                  }}
                  className={`block w-full touch-manipulation px-4 py-3 text-left text-base transition ${
                    e.id === value
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "text-[#f4eee3] hover:bg-[rgba(244,238,227,0.08)]"
                  }`}
                >
                  {e.name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
