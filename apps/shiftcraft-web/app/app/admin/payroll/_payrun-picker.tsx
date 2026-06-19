"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { readbackPayRunAction, type FormState } from "~/app/app/timesheets/xero-actions";

const INITIAL: FormState = { status: "idle" };

interface PayRun {
  payRunId: string;
  periodStart: string | null;
  periodEnd: string | null;
  paymentDate: string | null;
  status: string;
  wages: number | null;
  netPay: number | null;
}

// Picker for the read-back: Xero's UI never exposes the PayRunID GUID, so we
// list recent pay runs from the API and let the operator click one. Each row's
// "Read back" submits the GUID + the period-start (the week's Monday).
export function PayRunPicker({ payRuns }: { payRuns: PayRun[] }) {
  const [state, action] = useActionState(readbackPayRunAction, INITIAL);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Pick the finalised pay run to pull totals from — no GUID hunting (Xero
        doesn&rsquo;t expose it in its UI). Reads gross / net / tax / super back
        into ShiftCraft for the Reports page.
      </p>
      {payRuns.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pay runs found in Xero yet. Post a pay run there, then refresh.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Period</th>
                <th className="py-1.5 pr-3 font-medium">Payment date</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Gross</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {payRuns.map((r) => (
                <tr key={r.payRunId} className="border-b border-border/60">
                  <td className="py-1.5 pr-3">
                    {r.periodStart ?? "?"} → {r.periodEnd ?? "?"}
                  </td>
                  <td className="py-1.5 pr-3">{r.paymentDate ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.status}</td>
                  <td className="py-1.5 pr-3">
                    {r.wages != null ? `$${r.wages.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    <form action={action}>
                      <input type="hidden" name="weekStart" value={r.periodStart ?? ""} />
                      <input type="hidden" name="xeroPayRunId" value={r.payRunId} />
                      <ReadBackButton disabled={!r.periodStart} />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {state.status === "ok" ? (
        <p className="text-xs text-[var(--live)]">{state.message}</p>
      ) : null}
      {state.status === "error" ? (
        <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
      ) : null}
    </div>
  );
}

function ReadBackButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "Reading…" : "Read back"}
    </button>
  );
}
