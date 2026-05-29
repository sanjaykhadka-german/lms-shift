"use client";

import { useTransition } from "react";
import {
  approveTimesheetAction,
  clearTimesheetApprovalAction,
  disputeTimesheetAction,
} from "./actions";

// Per-row approve / dispute / reset buttons.
//
// The previous implementation rendered three inline <form action={...}>
// elements per row, which Next 16 + React 19 reject because the table
// itself is wrapped in <BulkSelectionForm>'s outer <form> (nested forms
// are invalid HTML and cause hydration mismatch).
//
// The fix is to call the server actions imperatively from a client
// component — no inner <form> element needed. FormData is constructed
// at click time with just the fields the action requires.

type ApprovalStatus = "approved" | "disputed" | null;

export function ApprovalButtons({
  userId,
  weekStartIso,
  status,
  hasActivity,
}: {
  userId: string;
  weekStartIso: string;
  status: ApprovalStatus;
  hasActivity: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const submit = (
    action: (formData: FormData) => Promise<void>,
    extra?: Record<string, string>,
  ) => {
    const fd = new FormData();
    fd.append("employeeUserId", userId);
    fd.append("weekStart", weekStartIso);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        fd.append(k, v);
      }
    }
    startTransition(async () => {
      await action(fd);
    });
  };

  return (
    <div className="flex flex-wrap gap-1">
      {status !== "approved" && hasActivity ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(approveTimesheetAction)}
          className="rounded-md bg-[var(--live)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[color-mix(in_srgb,var(--live)_85%,black)] disabled:opacity-50"
        >
          Approve
        </button>
      ) : null}
      {status !== "disputed" && hasActivity ? (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            submit(disputeTimesheetAction, {
              notes: "Flagged by manager — please review punches.",
            })
          }
          className="rounded-md bg-[var(--warn)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-[color-mix(in_srgb,var(--warn)_85%,black)] disabled:opacity-50"
        >
          Dispute
        </button>
      ) : null}
      {status === "approved" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            // AUDIT.md #4 — reopening an approved timesheet writes an
            // audit event with a reason. Prompt keeps the slice tight;
            // upgrade to a proper modal in a follow-up if managers
            // start typing a lot here.
            const reason = window.prompt(
              "Reopen this approved timesheet?\n\nType a reason — it's saved to the audit log.",
              "",
            );
            if (reason == null) return;
            const trimmed = reason.trim();
            if (trimmed.length === 0) {
              window.alert("A reason is required to reopen.");
              return;
            }
            submit(clearTimesheetApprovalAction, { reason: trimmed });
          }}
          className="rounded-md border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] disabled:opacity-50"
        >
          Reopen
        </button>
      ) : status === "disputed" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(clearTimesheetApprovalAction)}
          className="rounded-md border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          Clear dispute
        </button>
      ) : null}
    </div>
  );
}
