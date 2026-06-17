"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  approveWeekAndExportAction,
  exportToXeroAction,
  readbackPayRunAction,
  type FormState,
} from "~/app/app/timesheets/xero-actions";

const initial: FormState = { status: "idle" };

function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastMonday(): string {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - dow - 7); // previous week's Monday
  d.setHours(0, 0, 0, 0);
  return fmtIsoDate(d);
}

export function ExportToXeroForm() {
  const [state, formAction, pending] = useActionState(exportToXeroAction, initial);
  const [comboState, comboAction, comboPending] = useActionState(
    approveWeekAndExportAction,
    initial,
  );
  const defaultWeek = lastMonday();
  const busy = pending || comboPending;
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="weekStart">Week of (Monday)</Label>
        <Input
          id="weekStart"
          name="weekStart"
          type="date"
          defaultValue={defaultWeek}
          required
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {pending ? "Pushing…" : "Send timesheets to Xero"}
        </Button>
        {/* Same form fields; formAction overrides to the combo action so
            "approve the week, then export" is one click. */}
        <Button
          type="submit"
          formAction={comboAction}
          variant="outline"
          disabled={busy}
        >
          {comboPending ? "Approving & pushing…" : "Approve week & send"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        “Approve week &amp; send” signs off every employee with activity that
        week (leaving disputed ones untouched), then exports — for when
        you&rsquo;ve already reviewed the week.
      </p>
      {state.status === "ok" && (
        <p className="text-xs text-[var(--live)]">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
      )}
      {comboState.status === "ok" && (
        <p className="text-xs text-[var(--live)]">{comboState.message}</p>
      )}
      {comboState.status === "error" && (
        <p className="text-xs text-[color:var(--destructive)]">
          {comboState.message}
        </p>
      )}
    </form>
  );
}

export function ReadbackForm() {
  const [state, formAction, pending] = useActionState(readbackPayRunAction, initial);
  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="readback_weekStart">Week of (Monday)</Label>
        <Input
          id="readback_weekStart"
          name="weekStart"
          type="date"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="xeroPayRunId">Xero pay run ID</Label>
        <Input
          id="xeroPayRunId"
          name="xeroPayRunId"
          placeholder="e.g. e3a5d3a9-..."
          required
          className="font-mono text-xs"
        />
      </div>
      <Button type="submit" disabled={pending} variant="outline">
        {pending ? "Reading…" : "Pull finalised totals"}
      </Button>
      {state.status === "ok" && (
        <p className="text-xs text-[var(--live)]">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
      )}
    </form>
  );
}
