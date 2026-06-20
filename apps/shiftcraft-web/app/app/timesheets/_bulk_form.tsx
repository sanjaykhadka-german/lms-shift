"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { bulkApproveAction, bulkDisputeAction } from "./actions";

// Wraps the timesheets <table> in a single form so checkboxes on each row
// collect into one FormData submission. The form's default action is
// approve; each submit button can override with formAction= to dispute.
//
// Tracking the count + Clear button are client-only — we don't reach for
// useState on each checkbox, we just query the form's checked inputs on
// any change. That avoids re-rendering rows when toggling selections.

export function BulkSelectionForm({
  weekStartIso,
  pendingUserIds,
  children,
}: {
  weekStartIso: string;
  /** R1 Feature 1 — every worked-but-unapproved user in the current
   *  (dept-filtered) view; drives the one-click "Approve all pending" button. */
  pendingUserIds: string[];
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [approvingAll, startApproveAll] = useTransition();
  const router = useRouter();

  // R1 Feature 1 — approve every pending timesheet in the current view in one
  // click (e.g. "approve all of Dispatch this week"), reusing bulkApproveAction.
  function approveAllPending() {
    if (pendingUserIds.length === 0) return;
    if (
      !window.confirm(
        `Approve all ${pendingUserIds.length} pending timesheet${
          pendingUserIds.length === 1 ? "" : "s"
        } in this view?`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.append("weekStart", weekStartIso);
    for (const id of pendingUserIds) fd.append("userId", id);
    startApproveAll(async () => {
      await bulkApproveAction(fd);
      router.refresh();
    });
  }

  function recount() {
    const form = formRef.current;
    if (!form) {
      setSelectedCount(0);
      return;
    }
    const checked = form.querySelectorAll<HTMLInputElement>(
      'input[name="userId"]:checked',
    );
    setSelectedCount(checked.length);
  }

  function clearSelection() {
    const form = formRef.current;
    if (!form) return;
    const checked = form.querySelectorAll<HTMLInputElement>(
      'input[name="userId"]:checked',
    );
    checked.forEach((i) => {
      i.checked = false;
    });
    setSelectedCount(0);
  }

  return (
    <form ref={formRef} onChange={recount}>
      <input type="hidden" name="weekStart" value={weekStartIso} />

      {pendingUserIds.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={approveAllPending}
            disabled={approvingAll}
            className="rounded-md bg-[var(--live)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white hover:bg-[color-mix(in_srgb,var(--live)_85%,black)] disabled:opacity-60"
          >
            {approvingAll
              ? "Approving…"
              : `Approve all pending (${pendingUserIds.length})`}
          </button>
          <span className="text-muted-foreground">
            approves every worked-but-unapproved timesheet in this view
          </span>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm shadow-sm">
          <span className="font-medium">{selectedCount} selected</span>
          <span className="text-muted-foreground">·</span>
          <button
            type="submit"
            formAction={bulkApproveAction}
            className="rounded-md bg-[var(--live)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white hover:bg-[color-mix(in_srgb,var(--live)_85%,black)]"
          >
            Approve {selectedCount}
          </button>
          <button
            type="submit"
            formAction={bulkDisputeAction}
            className="rounded-md bg-[var(--warn)] px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white hover:bg-[color-mix(in_srgb,var(--warn)_85%,black)]"
          >
            Dispute {selectedCount}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Clear
          </button>
        </div>
      ) : null}

      {children}
    </form>
  );
}
