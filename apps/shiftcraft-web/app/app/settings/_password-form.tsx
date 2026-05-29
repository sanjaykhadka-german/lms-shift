"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { changePasswordAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

function fieldErr(state: FormState, k: string): string | null {
  if (state.status !== "error") return null;
  return state.fieldErrors?.[k]?.[0] ?? null;
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-4" key={state.status === "ok" ? "reset" : "open"}>
      <div className="space-y-1.5">
        <Label htmlFor="current">Current password</Label>
        <PasswordInput
          id="current"
          name="current"
          autoComplete="current-password"
          required
          aria-invalid={!!fieldErr(state, "current")}
        />
        {fieldErr(state, "current") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "current")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="next">New password</Label>
        <PasswordInput
          id="next"
          name="next"
          autoComplete="new-password"
          required
          aria-invalid={!!fieldErr(state, "next")}
        />
        {fieldErr(state, "next") ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "next")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            At least 8 characters. Different from your current password.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          required
          aria-invalid={!!fieldErr(state, "confirm")}
        />
        {fieldErr(state, "confirm") && (
          <p className="text-xs text-[color:var(--destructive)]">
            {fieldErr(state, "confirm")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Changing…" : "Change password"}
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
