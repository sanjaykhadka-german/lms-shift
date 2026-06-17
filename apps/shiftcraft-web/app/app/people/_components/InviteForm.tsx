"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { createInvitationAction, type InviteState } from "../_actions";

const INITIAL: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction] = useActionState(createInvitationAction, INITIAL);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <label
          htmlFor="invite-email"
          className="block text-xs font-medium text-muted-foreground"
        >
          Email
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="teammate@example.com"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.email}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {state.status === "error" && state.fieldErrors?.email ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="invite-role"
          className="block text-xs font-medium text-muted-foreground"
        >
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="member">Employee</option>
          <option value="location_manager">Location Manager</option>
          <option value="admin">Manager</option>
        </select>
      </div>
      <SubmitButton />
      {state.status === "ok" ? (
        <p className="basis-full text-xs text-[var(--live)]">{state.message}</p>
      ) : null}
      {state.status === "error" && !state.fieldErrors ? (
        <p className="basis-full text-xs text-[color:var(--destructive)]">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending…" : "Send invitation"}
    </Button>
  );
}
