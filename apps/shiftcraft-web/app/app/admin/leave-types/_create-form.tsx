"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createLeaveTypeAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

export function CreateLeaveTypeForm() {
  const [state, formAction, pending] = useActionState(
    createLeaveTypeAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="name">New leave type</Label>
        <Input
          id="name"
          name="name"
          placeholder="e.g. Bereavement leave"
          required
          maxLength={80}
        />
        {state.status === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.name[0]}
          </p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
      {state.status === "ok" && (
        <p className="text-xs text-[var(--live)] sm:self-center">{state.message}</p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="text-xs text-[color:var(--destructive)] sm:self-center">
          {state.message}
        </p>
      )}
    </form>
  );
}
