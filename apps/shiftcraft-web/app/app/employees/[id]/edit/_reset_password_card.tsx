"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  resetEmployeePasswordAction,
  type ResetPasswordFormState,
} from "../../new/actions";
import { Button } from "~/components/ui/button";

const INITIAL_STATE: ResetPasswordFormState = { status: "idle" };

// Manager-facing "reset this employee's web-login password" card. Mirrors the
// kiosk PIN card; sits on /app/employees/[id]/edit beneath it.
export function ResetPasswordCard({ appUserId }: { appUserId: string }) {
  const boundAction = resetEmployeePasswordAction.bind(null, appUserId);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Login password</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Set a new password for this employee's web sign-in (email +
            password). Use this if they're locked out and can't reset it
            themselves. It doesn't affect their kiosk PIN.
          </p>
          {state.status === "ok" ? (
            <p className="mt-2 text-xs text-[var(--live)]">{state.message}</p>
          ) : null}
        </div>
        {!open ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Reset password
          </Button>
        ) : null}
      </div>

      {open ? (
        <form action={formAction} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <PasswordInput name="next" label="New password" autoFocus />
            <PasswordInput name="confirm" label="Confirm password" />
          </div>
          {state.status === "error" ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <SubmitButton />
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function PasswordInput({
  name,
  label,
  autoFocus,
}: {
  name: string;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        type="password"
        name={name}
        minLength={8}
        autoComplete="new-password"
        autoFocus={autoFocus}
        className="rounded-md border border-border bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="At least 8 characters"
        required
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save password"}
    </Button>
  );
}
