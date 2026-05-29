"use client";

import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";

function format(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { hms: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
}

/**
 * Ticking HH:MM:SS clock in mono with a pulsing emerald "live" dot.
 * `variant="kiosk"` renders the large device clock with seconds in accent.
 */
export function LiveClock({
  variant = "bar",
  className,
}: {
  variant?: "bar" | "kiosk";
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hms = now ? format(now).hms : "--:--:--";

  if (variant === "kiosk") {
    const [hh, mm, ss] = hms.split(":");
    return (
      <div className={cn("font-mono font-semibold tabular-nums", className)}>
        <span className="text-[var(--ink)]">{hh}</span>
        <span className="text-[var(--ink)]">:{mm}</span>
        <span className="text-[var(--accent)]">:{ss}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 font-mono text-[15px] font-semibold tabular-nums text-ink",
        className,
      )}
    >
      <span
        aria-hidden
        className="h-[7px] w-[7px] animate-[sc-pulse_1.8s_infinite] rounded-full bg-[var(--live)] shadow-[0_0_0_4px_rgba(21,145,106,0.18)]"
      />
      {hms}
    </div>
  );
}
