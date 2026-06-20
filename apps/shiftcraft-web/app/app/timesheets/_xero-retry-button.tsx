"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { exportToXeroAction, type FormState } from "./xero-actions";

const initial: FormState = { status: "idle" };

// R1 Feature 2 — re-run the Xero export for a week whose last push failed,
// right where the failure shows (the timesheets grid) instead of making the
// admin go back to /app/admin/payroll. exportToXeroAction is idempotent on
// (tenant, week) — a retry with unchanged hours is safe; corrected hours
// re-push cleanly. The action revalidates /app/timesheets, so the per-row
// "Xero ✓/✗" chips refresh on success.
export function XeroRetryButton({
  weekStartIso,
  lastError,
}: {
  weekStartIso: string;
  lastError: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    exportToXeroAction,
    initial,
  );
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="weekStart" value={weekStartIso} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        title={lastError ?? "The last Xero export for this week failed"}
      >
        {pending ? "Retrying…" : "Retry Xero export"}
      </Button>
      {state.status === "idle" && lastError ? (
        <span className="text-xs text-[color:var(--destructive)]">
          Last push failed: {lastError}
        </span>
      ) : null}
      {state.status === "ok" && (
        <span className="text-xs text-[var(--live)]">{state.message}</span>
      )}
      {state.status === "error" && (
        <span className="text-xs text-[color:var(--destructive)]">
          {state.message}
        </span>
      )}
    </form>
  );
}
