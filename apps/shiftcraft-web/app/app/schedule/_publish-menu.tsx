"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkPublishSelectedAreasAction } from "./actions";

interface Area {
  locationId: string;
  role: string;
  count: number;
  label: string;
}

// "Publish N changes" dropdown. Each area (location › role) has a checkbox so a
// manager can publish just the chosen areas; with nothing checked, "Publish
// all" publishes the whole week.
export function PublishMenu({
  weekStartIso,
  weekEndIso,
  draftCount,
  areas,
}: {
  weekStartIso: string;
  weekEndIso: string;
  draftCount: number;
  areas: Area[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const keyOf = (a: Area) => `${a.locationId}|${a.role}`;
  const allSelected = areas.length > 0 && selected.size === areas.length;
  const toggle = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(areas.map(keyOf)));

  function publish() {
    const chosen = areas.filter((a) => selected.has(keyOf(a)));
    startTransition(async () => {
      await bulkPublishSelectedAreasAction({
        weekStartIso,
        weekEndIso,
        areas: chosen.map((a) => ({ locationId: a.locationId, role: a.role })),
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  const btnLabel = pending
    ? "Publishing…"
    : selected.size > 0
      ? `Publish ${selected.size} area${selected.size === 1 ? "" : "s"}`
      : "Publish all";

  return (
    <details className="group relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 whitespace-nowrap rounded-[var(--r-sm)] bg-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--accent-ink)] shadow-[0_8px_18px_-10px_var(--accent-deep)] transition-[filter] hover:brightness-[0.97] [&::-webkit-details-marker]:hidden">
        Publish {draftCount} change{draftCount === 1 ? "" : "s"}
        <span
          aria-hidden
          className="text-[10px] opacity-80 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="absolute right-0 z-30 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-[var(--r-md)] border border-line bg-[var(--paper)] p-2 shadow-[var(--shadow-md)]">
        {areas.length > 1 && (
          <label className="flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-sm font-medium text-ink hover:bg-[var(--paper-2)]">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="accent-[var(--accent-deep)]"
            />
            <span className="flex-1">All areas</span>
            <span className="font-mono text-xs text-ink-2">{draftCount}</span>
          </label>
        )}
        <p className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          By area
        </p>
        {areas.map((a) => {
          const k = keyOf(a);
          return (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-sm text-ink-2 hover:bg-[var(--paper-2)] hover:text-ink"
            >
              <input
                type="checkbox"
                checked={selected.has(k)}
                onChange={() => toggle(k)}
                className="accent-[var(--accent-deep)]"
              />
              <span className="flex-1 truncate">{a.label}</span>
              <span className="font-mono text-xs text-ink-3">{a.count}</span>
            </label>
          );
        })}
        <button
          type="button"
          onClick={publish}
          disabled={pending}
          className="mt-2 w-full rounded-[var(--r-sm)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--accent-ink)] transition-[filter] hover:brightness-[0.97] disabled:opacity-60"
        >
          {btnLabel}
        </button>
      </div>
    </details>
  );
}
