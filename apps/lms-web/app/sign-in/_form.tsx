"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { signInAction, type SignInState } from "./actions";

const initial: SignInState = { status: "idle" };

export function SignInForm({
  prefilledEmail,
  returnTo,
}: {
  prefilledEmail?: string;
  returnTo?: string;
}) {
  const [state, action, pending] = useActionState(signInAction, initial);

  return (
    <form action={action} className="space-y-4">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={prefilledEmail}
        errors={state.status === "error" ? state.fieldErrors?.email : undefined}
      />
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.password}
        />
        {state.status === "error" && state.fieldErrors?.password && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {state.fieldErrors.password[0]}
          </p>
        )}
      </div>
      {state.status === "error" && !state.fieldErrors && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {state.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  type,
  autoComplete,
  defaultValue,
  errors,
}: {
  name: string;
  label: string;
  type: string;
  autoComplete?: string;
  defaultValue?: string;
  errors?: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={errors ? true : undefined}
      />
      {errors && errors.length > 0 && (
        <p className="text-xs text-red-600 dark:text-red-400">{errors[0]}</p>
      )}
    </div>
  );
}
