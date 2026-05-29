"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const initial: FormState = { status: "idle" };

interface NameCrudFormProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  placeholder: string;
  submitLabel: string;
  submitTooltip?: string;
}

/** Shared "single text field, list-style add" form used across the admin
 *  config screens (departments, employers, etc). */
export function NameCrudForm({ action, label, placeholder, submitLabel, submitTooltip }: NameCrudFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" key={state.status === "ok" ? state.message : "form"}>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={`field-${label}`}>{label}</Label>
        <Input
          id={`field-${label}`}
          name="name"
          placeholder={placeholder}
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.name}
        />
        {state.status === "error" && state.fieldErrors?.name && (
          <p className="text-xs text-[color:var(--destructive)]">{state.fieldErrors.name[0]}</p>
        )}
      </div>
      <Button type="submit" disabled={pending} tooltip={submitTooltip}>
        {pending ? "Saving…" : submitLabel}
      </Button>
      {state.status === "ok" && (
        <p className="basis-full text-xs text-emerald-600">{state.message}</p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="basis-full text-xs text-[color:var(--destructive)]">{state.message}</p>
      )}
    </form>
  );
}
