"use client";

import * as React from "react";
import { cn } from "~/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

/**
 * Segmented control — a pill group of mutually exclusive options. Controlled
 * via `value`/`onValueChange`. Used for filters (timesheets), metric toggles
 * (reports), location filter (schedule), and the auth Sign in / Create toggle.
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex gap-0.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "rounded-[calc(var(--r-sm)-3px)] px-3 py-1.5 text-[13px] font-semibold transition-colors",
              active
                ? "bg-[var(--raise)] text-ink shadow-[var(--shadow-sm)] dark:bg-[var(--accent)] dark:text-[var(--accent-ink)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
