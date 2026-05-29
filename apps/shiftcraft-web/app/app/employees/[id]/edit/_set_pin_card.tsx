"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  removePinAction,
  setPinAction,
  type PinFormState,
} from "../../new/actions";
import { Button } from "~/components/ui/button";

interface SetPinCardProps {
  appUserId: string;
  hasPin: boolean;
  lastUsedAt: Date | null;
}

const INITIAL_STATE: PinFormState = { status: "idle" };

export function SetPinCard({ appUserId, hasPin, lastUsedAt }: SetPinCardProps) {
  const boundAction = setPinAction.bind(null, appUserId);
  const [state, formAction] = useActionState(boundAction, INITIAL_STATE);
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Kiosk PIN</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            4-digit PIN this employee enters at the on-premise kiosk to
            clock in and out. Replaces email + password for kiosk
            authentication only — does not affect web login.
          </p>
          <p className="mt-2 text-xs">
            {hasPin ? (
              <>
                <span className="inline-flex items-center rounded-full bg-[var(--live)] px-2 py-0.5 text-[11px] font-medium text-white">
                  PIN set
                </span>
                {lastUsedAt ? (
                  <span className="ml-2 text-muted-foreground">
                    Last used{" "}
                    {lastUsedAt.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                ) : (
                  <span className="ml-2 text-muted-foreground">
                    Never used yet
                  </span>
                )}
              </>
            ) : (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                No PIN
              </span>
            )}
          </p>
        </div>
        {!open ? (
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            {hasPin ? "Change PIN" : "Set PIN"}
          </Button>
        ) : null}
      </div>

      {open ? (
        <form action={formAction} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <PinInput name="pin" label="New PIN" autoFocus />
            <PinInput name="confirm" label="Confirm PIN" />
          </div>
          {state.status === "error" ? (
            <p className="text-xs text-[color:var(--destructive)]">
              {state.message}
            </p>
          ) : null}
          {state.status === "ok" ? (
            <p className="text-xs text-[var(--live)]">{state.message}</p>
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

      {hasPin && !open ? (
        <form action={removePinAction} className="mt-4 border-t border-border pt-3">
          <input type="hidden" name="appUserId" value={appUserId} />
          <button
            type="submit"
            className="text-xs text-[color:var(--destructive)] hover:underline"
          >
            Remove PIN
          </button>
        </form>
      ) : null}
    </section>
  );
}

function PinInput({
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
        inputMode="numeric"
        pattern="\d{4}"
        name={name}
        maxLength={4}
        autoComplete="off"
        autoFocus={autoFocus}
        className="rounded-md border border-border bg-background px-3 py-2 text-base tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="••••"
        required
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save PIN"}
    </Button>
  );
}
