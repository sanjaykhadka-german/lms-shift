"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setCanViewTimesheetsAction, type RoleFormState } from "../../new/actions";
import { Button } from "~/components/ui/button";

const INITIAL: RoleFormState = { status: "idle" };

export function TimesheetAccessCard({
  employeeId,
  current,
}: {
  employeeId: string;
  current: boolean;
}) {
  const action = setCanViewTimesheetsAction.bind(null, employeeId);
  const [state, formAction] = useActionState(action, INITIAL);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Timesheet access</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Let this employee view their team&rsquo;s timesheets (read-only,
        limited to their location). Managers already have full access — this is
        for trusted non-managers. Everyone can always see their own.
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="canViewTimesheets"
            defaultChecked={current}
          />
          Can view team timesheets
        </label>
        <div className="flex items-center gap-3">
          <SubmitButton />
          {state.status === "ok" ? (
            <p className="text-xs text-[var(--live)]">{state.message}</p>
          ) : null}
          {state.status === "error" ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save access"}
    </Button>
  );
}
