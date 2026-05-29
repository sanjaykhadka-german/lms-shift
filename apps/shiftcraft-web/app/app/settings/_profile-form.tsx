"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateProfileAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

function fieldErr(state: FormState, k: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[k]?.[0] ?? null;
}

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, formAction, pending] = useActionState(
    updateProfileAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Display name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          required
          aria-invalid={!!fieldErr(state, "name")}
        />
        {fieldErr(state, "name") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "name")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
