"use client";

import { useRef, useState, type ReactNode } from "react";
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
  children,
}: {
  weekStartIso: string;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);

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
