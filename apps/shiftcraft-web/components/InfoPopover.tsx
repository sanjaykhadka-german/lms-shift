"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";

// Small "i" affordance that toggles a popover with help text. Used to
// explain newly-shipped affordances on shared pages (timesheets, team
// docs, employee edit) without cluttering the layout with always-on
// paragraphs. Click to toggle; outside-click or Escape to close.

interface Props {
  children: ReactNode;
  /** aria-label override for accessibility — falls back to "More info". */
  label?: string;
  /** Tailwind alignment of the popover relative to the trigger. */
  align?: "left" | "right";
}

export function InfoPopover({ children, label = "More info", align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          className={
            "absolute top-full z-30 mt-1 w-64 rounded-md border border-border bg-card p-3 text-[11px] leading-relaxed text-foreground shadow-lg " +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
