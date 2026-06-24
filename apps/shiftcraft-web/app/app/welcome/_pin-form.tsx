"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { selfSetPinAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

interface PinFormProps {
  hasPin: boolean;
  /** Pre-formatted on the server (e.g. "23 Jun 2026") so SSR and client render
   *  the identical string — formatting a Date here would mismatch between the
   *  server (Node ICU) and the browser. Null when the PIN was never used. */
  lastUsedLabel: string | null;
}

export function PinForm({ hasPin, lastUsedLabel }: PinFormProps) {
  const [state, formAction] = useActionState(selfSetPinAction, initial);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <p className="text-xs">
        {hasPin ? (
          <>
            <span className="inline-flex items-center rounded-full bg-[var(--live)] px-2 py-0.5 text-[11px] font-medium text-white">
              PIN set
            </span>
            {lastUsedLabel ? (
              <span className="ml-2 text-muted-foreground">
                Last used {lastUsedLabel}
              </span>
            ) : (
              <span className="ml-2 text-muted-foreground">
                Never used yet
              </span>
            )}
          </>
        ) : (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            No PIN yet
          </span>
        )}
      </p>

      {!open ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setOpen(true)}
        >
          {hasPin ? "Change PIN" : "Set PIN"}
        </Button>
      ) : (
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
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
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
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save PIN"}
    </Button>
  );
}
