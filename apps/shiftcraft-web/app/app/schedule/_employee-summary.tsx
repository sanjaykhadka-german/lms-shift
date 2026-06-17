"use client";

import { useEffect, useState } from "react";
import { Avatar } from "~/components/Avatar";

// Clickable employee row in the Employee schedule view. Tapping the name opens
// a lightweight modal summarising the employee's scheduled hours and base pay
// for the currently visible range (1 or 2 weeks). Hours are gross scheduled
// time (shift end − start); base pay = hours × hourly rate.
export function EmployeeSummaryCell({
  fullName,
  email,
  hourlyRate,
  totalMs,
  shiftCount,
  rangeLabel,
}: {
  fullName: string;
  email: string | null;
  hourlyRate: string | null;
  totalMs: number;
  shiftCount: number;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const hours = totalMs / 3_600_000;
  const rate = hourlyRate != null ? Number(hourlyRate) : null;
  const pay = rate != null ? hours * rate : null;
  const hoursLabel = `${hours.toFixed(2)} h`;
  const money = (n: number) =>
    n.toLocaleString(undefined, {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 2,
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded text-left transition-colors hover:text-[var(--accent-deep)]"
      >
        <Avatar
          name={fullName}
          email={email ?? ""}
          image={null}
          sizeClass="h-7 w-7"
          textClass="text-[10px]"
        />
        <span className="truncate text-xs font-medium">{fullName}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${fullName} summary`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-xs rounded-xl border border-border bg-[var(--paper)] p-5 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <Avatar
                name={fullName}
                email={email ?? ""}
                image={null}
                sizeClass="h-10 w-10"
                textClass="text-sm"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
                  {fullName}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  {rangeLabel}
                </div>
              </div>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-2">Shifts</dt>
                <dd className="font-mono tabular-nums text-ink">{shiftCount}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-2">Scheduled hours</dt>
                <dd className="font-mono tabular-nums text-ink">{hoursLabel}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-2">Base rate</dt>
                <dd className="font-mono tabular-nums text-ink">
                  {rate != null ? `${money(rate)}/h` : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-line pt-2">
                <dt className="font-medium text-ink">Base pay</dt>
                <dd className="font-mono tabular-nums font-semibold text-ink">
                  {pay != null ? money(pay) : "No rate set"}
                </dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-[var(--r-sm)] border border-[color:var(--input)] py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-[var(--paper-2)] hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
