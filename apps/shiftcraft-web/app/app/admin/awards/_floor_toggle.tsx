"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { setFloorBlockAction, type FormState } from "./actions";

const INITIAL: FormState = { status: "idle" };

export function FloorToggle({ block }: { block: boolean }) {
  const [state, action] = useActionState(setFloorBlockAction, INITIAL);
  return (
    <form
      action={action}
      className="rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold">Minimum-rate enforcement</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        When a team member&rsquo;s rate is below their classification minimum,
        warn (default) or hard-block. Block surfaces here and can be enforced by
        the payroll-export approval gate.
      </p>
      <label className="mt-3 inline-flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="block"
          defaultChecked={block}
          className="h-4 w-4 accent-primary"
        />
        <span>Hard-block under-minimum rates</span>
      </label>
      <div className="mt-3 flex items-center gap-3">
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
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
