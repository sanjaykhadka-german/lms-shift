"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createInvitationAction, type InviteState } from "./actions";

const initial: InviteState = { status: "idle" };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(createInvitationAction, initial);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="teammate@example.com"
          required
          aria-invalid={state.status === "error" && !!state.fieldErrors?.email}
        />
        {state.status === "error" && state.fieldErrors?.email && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.email[0]}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send invitation"}
      </Button>
      {state.status === "ok" && (
        <p className="basis-full text-xs text-[color:var(--success-foreground,inherit)]">
          {state.message}
        </p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="basis-full text-xs text-[color:var(--destructive)]">{state.message}</p>
      )}
    </form>
  );
}
