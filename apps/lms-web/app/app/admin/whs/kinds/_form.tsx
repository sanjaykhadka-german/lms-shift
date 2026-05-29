"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { FormState } from "../../_components/NameCrudForm";

interface WhsKindFormProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}

const initial: FormState = { status: "idle" };

export function WhsKindForm({ action }: WhsKindFormProps) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      key={state.status === "ok" ? state.message : "form"}
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="kind-label">Kind name</Label>
        <Input
          id="kind-label"
          name="label"
          placeholder="e.g. Working with Children Check"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.label}
        />
        {state.status === "error" && state.fieldErrors?.label && (
          <p className="text-xs text-[color:var(--destructive)]">{state.fieldErrors.label[0]}</p>
        )}
      </div>
      <div className="space-y-1.5 sm:w-48">
        <Label htmlFor="kind-category">Category</Label>
        <select
          id="kind-category"
          name="category"
          defaultValue="expiry"
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
        >
          <option value="expiry">Expiry (licence / cert)</option>
          <option value="incident">Incident</option>
        </select>
        {state.status === "error" && state.fieldErrors?.category && (
          <p className="text-xs text-[color:var(--destructive)]">{state.fieldErrors.category[0]}</p>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
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
