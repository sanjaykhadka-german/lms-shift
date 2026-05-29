import * as React from "react";
import { cn } from "~/lib/utils";

/**
 * Stat tile — big mono value (+ optional unit), mono uppercase label, and an
 * optional corner trend. Used on dashboard / timesheets / reports headers.
 */
export function Stat({
  value,
  unit,
  label,
  trend,
  className,
}: {
  value: React.ReactNode;
  unit?: string;
  label: string;
  trend?: { text: string; direction?: "up" | "down" };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--r-md)] border border-line bg-[var(--paper)] px-[18px] py-4",
        className,
      )}
    >
      {trend && (
        <span
          className={cn(
            "absolute right-3.5 top-3.5 font-mono text-[11px] font-semibold",
            trend.direction === "down" ? "text-[var(--danger)]" : "text-[var(--live)]",
          )}
        >
          {trend.text}
        </span>
      )}
      <div className="font-mono text-[30px] font-semibold leading-none tracking-[-0.01em] text-ink">
        {value}
        {unit && <span className="text-sm text-ink-3"> {unit}</span>}
      </div>
      <div className="mt-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
        {label}
      </div>
    </div>
  );
}
