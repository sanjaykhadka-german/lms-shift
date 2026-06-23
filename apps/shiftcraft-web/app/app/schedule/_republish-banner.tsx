"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { republishEditedShiftsAction } from "./actions";

// Item 2: when a published shift is moved or amended it must be re-published so
// staff stop seeing the stale version. This banner makes that obvious and
// one-click. It targets ONLY already-published-but-edited shifts in the visible
// range — never-published drafts stay with the Publish menu.
export function RepublishBanner({
  count,
  weekStartIso,
  weekEndIso,
  location,
}: {
  count: number;
  weekStartIso: string;
  weekEndIso: string;
  location?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (count <= 0) return null;

  function republish() {
    startTransition(async () => {
      await republishEditedShiftsAction({ weekStartIso, weekEndIso, location });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--warn)_50%,transparent)] bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] px-4 py-2.5 text-sm">
      <span className="font-medium text-ink">
        {count} published {count === 1 ? "shift was" : "shifts were"} changed
        since going live — staff still see the old version.
      </span>
      <button
        type="button"
        onClick={republish}
        disabled={pending}
        className="ml-auto inline-flex h-8 items-center rounded-[var(--r-sm)] bg-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--accent-ink)] transition-[filter] hover:brightness-[0.97] disabled:opacity-60"
      >
        {pending
          ? "Re-publishing…"
          : `Re-publish ${count} change${count === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
