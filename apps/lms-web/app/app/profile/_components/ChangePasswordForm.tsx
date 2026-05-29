"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { PasswordInput } from "~/components/ui/password-input";
import { changePasswordAction, type ProfileFormState } from "../actions";

const initial: ProfileFormState = { status: "idle" };

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <Banner state={state} />
      <div className="space-y-1">
        <Label htmlFor="current">Current password</Label>
        <PasswordInput
          id="current"
          name="current"
          required
          autoComplete="current-password"
        />
        <FieldError errors={state.fieldErrors?.current} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="next">New password</Label>
        <PasswordInput
          id="next"
          name="next"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <FieldError errors={state.fieldErrors?.next} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm new password</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <FieldError errors={state.fieldErrors?.confirm} />
      </div>
      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Updating…" : "Update password"}
    </Button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-red-600 dark:text-red-400">{errors[0]}</p>;
}

function Banner({ state }: { state: ProfileFormState }) {
  if (state.status === "ok") {
    return (
      <div className="rounded-md border border-emerald-500 bg-emerald-50/50 px-3 py-2 text-sm dark:bg-emerald-900/10">
        {state.message ?? "Password updated."}
      </div>
    );
  }
  if (state.status === "error" && state.message) {
    return (
      <div className="rounded-md border border-red-500 bg-red-50/50 px-3 py-2 text-sm dark:bg-red-900/10">
        {state.message}
      </div>
    );
  }
  return null;
}
