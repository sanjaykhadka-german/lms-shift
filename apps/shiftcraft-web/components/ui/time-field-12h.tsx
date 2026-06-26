"use client";

import { useState } from "react";

// 12-hour (AM/PM) time field. Renders hour / minute / AM-PM selects and emits a
// 24-hour "HH:MM" string through a hidden input named `name`, so server actions
// that already parse HH:MM stay unchanged. Supports both controlled
// (value + onChange) and uncontrolled (defaultValue) use.

export function to12h(
  hhmm: string,
): { hour: string; minute: string; ampm: "AM" | "PM" } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { hour: String(h), minute: m[2] ?? "00", ampm };
}

export function from12h(hour: string, minute: string, ampm: "AM" | "PM"): string {
  let h = Number(hour) % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1)); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
); // "00".."59"

const selectCls =
  "h-9 rounded-md border border-[color:var(--input)] bg-transparent px-2 text-sm text-ink shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]";

export function TimeField12h({
  name,
  value,
  defaultValue,
  onChange,
  required,
  className,
}: {
  name: string;
  value?: string; // controlled "HH:MM" | ""
  defaultValue?: string; // uncontrolled "HH:MM" | ""
  onChange?: (v: string) => void;
  required?: boolean;
  className?: string;
}) {
  const seed = to12h(value ?? defaultValue ?? "");
  const [hour, setHour] = useState(seed?.hour ?? "");
  const [minute, setMinute] = useState(seed?.minute ?? "");
  const [ampm, setAmpm] = useState<"AM" | "PM">(seed?.ampm ?? "AM");

  const hhmm =
    hour !== "" && minute !== "" ? from12h(hour, minute, ampm) : "";

  const update = (next: {
    hour?: string;
    minute?: string;
    ampm?: "AM" | "PM";
  }) => {
    const h = next.hour ?? hour;
    const mi = next.minute ?? minute;
    const ap = next.ampm ?? ampm;
    if (next.hour !== undefined) setHour(next.hour);
    if (next.minute !== undefined) setMinute(next.minute);
    if (next.ampm !== undefined) setAmpm(next.ampm);
    onChange?.(h !== "" && mi !== "" ? from12h(h, mi, ap) : "");
  };

  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <select
        aria-label="Hour"
        required={required}
        value={hour}
        onChange={(e) => update({ hour: e.target.value })}
        className={selectCls}
      >
        <option value="" disabled>
          --
        </option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-sm text-ink-2">:</span>
      <select
        aria-label="Minute"
        required={required}
        value={minute}
        onChange={(e) => update({ minute: e.target.value })}
        className={selectCls}
      >
        <option value="" disabled>
          --
        </option>
        {MINUTES.map((mi) => (
          <option key={mi} value={mi}>
            {mi}
          </option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        value={ampm}
        onChange={(e) => update({ ampm: e.target.value as "AM" | "PM" })}
        className={selectCls}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
      <input type="hidden" name={name} value={hhmm} />
    </div>
  );
}
