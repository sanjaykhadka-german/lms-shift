"use client";

import { useState, type ReactNode } from "react";

// Per-day expansion row. The parent server component pre-formats every
// display string (clock labels, hours, currency) so this client component
// stays dumb — no server-only imports, no date math. ApprovalCell renders
// server-side and is passed in as a ReactNode prop.

export interface RowSegmentLabel {
  kind: "work" | "break";
  label: string;
}

export interface RowDayDetail {
  dayLabel: string;
  segments: RowSegmentLabel[];
}

export interface RowProps {
  userId: string;
  name: string;
  email: string;
  deptLabel: string | null;
  perDayDisplay: string[];
  totalWorkDisplay: string;
  totalBreakDisplay: string;
  costDisplay: string;
  perDayDetail: RowDayDetail[];
  totalColumnCount: number;
  approvalCell: ReactNode;
  isAdmin: boolean;
  showCost: boolean;
}

export function TimesheetRow({
  name,
  email,
  deptLabel,
  perDayDisplay,
  totalWorkDisplay,
  totalBreakDisplay,
  costDisplay,
  perDayDetail,
  totalColumnCount,
  approvalCell,
  isAdmin,
  showCost,
}: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = perDayDetail.length > 0;

  return (
    <>
      <tr>
        <td className="px-2 py-2 align-middle">
          {canExpand ? (
            <button
              type="button"
              aria-label={expanded ? "Collapse details" : "Expand details"}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-xs text-muted-foreground hover:bg-muted"
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="inline-block h-6 w-6" aria-hidden />
          )}
        </td>
        <td className="px-4 py-2">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-muted-foreground">
            {email}
            {isAdmin && deptLabel ? (
              <span className="ml-2 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {deptLabel}
              </span>
            ) : null}
          </div>
        </td>
        {perDayDisplay.map((s, i) => (
          <td
            key={i}
            className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {s}
          </td>
        ))}
        <td className="px-3 py-2 font-mono text-sm tabular-nums font-semibold">
          {totalWorkDisplay}
        </td>
        <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
          {totalBreakDisplay}
        </td>
        {showCost ? (
          <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
            {costDisplay}
          </td>
        ) : null}
        <td className="px-3 py-2 align-top">{approvalCell}</td>
      </tr>
      {expanded && canExpand ? (
        <tr className="bg-muted/30">
          <td colSpan={totalColumnCount} className="px-6 py-3">
            <ul className="space-y-1.5 text-xs">
              {perDayDetail.map((d) => (
                <li key={d.dayLabel} className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="min-w-[5.5rem] font-medium text-foreground">
                    {d.dayLabel}
                  </span>
                  <span className="flex flex-wrap gap-2 text-muted-foreground">
                    {d.segments.map((s, i) => (
                      <span
                        key={i}
                        className={
                          s.kind === "work"
                            ? "inline-flex items-center gap-1 rounded-md bg-emerald-600/10 px-2 py-0.5 font-mono tabular-nums text-emerald-700 dark:text-emerald-400"
                            : "inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 font-mono tabular-nums text-amber-700 dark:text-amber-400"
                        }
                      >
                        <span className="text-[9px] uppercase tracking-wider opacity-70">
                          {s.kind === "work" ? "work" : "break"}
                        </span>
                        {s.label}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
