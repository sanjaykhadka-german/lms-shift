"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createTenantAction, type CreateTenantState } from "./actions";

const initial: CreateTenantState = { status: "idle" };

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createTenantAction, initial);
  const nameErrors = state.status === "error" ? state.fieldErrors?.name : undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          autoComplete="organization"
          required
          placeholder="e.g. German Butchery"
          aria-invalid={nameErrors ? true : undefined}
        />
        {nameErrors && nameErrors.length > 0 && (
          <p className="text-xs text-red-600 dark:text-red-400">{nameErrors[0]}</p>
        )}
      </div>
      {state.status === "error" && !state.fieldErrors && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
