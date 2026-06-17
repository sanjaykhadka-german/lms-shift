"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  setMemberRoleAction,
  type RoleFormState,
} from "../../new/actions";
import { Button } from "~/components/ui/button";

type Role = "owner" | "admin" | "location_manager" | "member";

interface RoleCardProps {
  appUserId: string;
  currentRole: Role;
  viewerRole: Role;
  /** True when target == viewer; used to confirm self-demotions. */
  isSelf: boolean;
}

const INITIAL: RoleFormState = { status: "idle" };

// Match lib/roles.ts → UI labels. Owner reads as "Admin", admin as
// "Manager", member as "Employee" (Deputy-style tier names).
const OPTIONS: Array<{ value: Role; label: string; desc: string }> = [
  {
    value: "owner",
    label: "Admin",
    desc: "Full access including billing, member management, and everything a Manager can do.",
  },
  {
    value: "location_manager",
    label: "Location Manager",
    desc: "A Manager scoped to their assigned location(s) — runs the roster, timesheets, and people for those sites only. No billing, workspace settings, or other locations. Assign their locations under Manager scopes.",
  },
  {
    value: "admin",
    label: "Manager",
    desc: "Day-to-day workspace management — schedule, employees, approvals, reports. No billing access.",
  },
  {
    value: "member",
    label: "Employee",
    desc: "Self-service only — own shifts, clock in/out, time-off requests.",
  },
];

const RANK: Record<Role, number> = {
  owner: 2,
  admin: 1,
  location_manager: 1,
  member: 0,
};

export function RoleCard({
  appUserId,
  currentRole,
  viewerRole,
  isSelf,
}: RoleCardProps) {
  const action = setMemberRoleAction.bind(null, appUserId);
  const [state, formAction] = useActionState(action, INITIAL);

  const viewerIsOwner = viewerRole === "owner";

  const isOptionDisabled = (target: Role): boolean => {
    // Mirrors server guard 1: only owners can move someone TO or FROM owner.
    if (!viewerIsOwner && (target === "owner" || currentRole === "owner")) {
      return true;
    }
    return false;
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Workspace role</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Controls what this person can do across the app. Independent of
        their Kiosk PIN.
      </p>

      <form
        action={formAction}
        onSubmit={(e) => {
          // Self-demotion confirm: if I'm changing my own role to one
          // lower-ranked than the current, warn before submitting. The
          // server still enforces last-owner protection.
          if (!isSelf) return;
          const data = new FormData(e.currentTarget);
          const next = String(data.get("role") ?? "") as Role;
          if (!next) return;
          if (RANK[next] < RANK[currentRole]) {
            const ok = window.confirm(
              "You're demoting yourself. You'll lose access to manager-only " +
                "screens immediately after saving. Continue?",
            );
            if (!ok) e.preventDefault();
          }
        }}
        className="mt-4 space-y-3"
      >
        {OPTIONS.map((opt) => {
          const disabled = isOptionDisabled(opt.value);
          return (
            <label
              key={opt.value}
              className={
                disabled
                  ? "flex items-start gap-3 rounded-md border border-border p-3 opacity-50"
                  : "flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50 cursor-pointer"
              }
            >
              <input
                type="radio"
                name="role"
                value={opt.value}
                defaultChecked={opt.value === currentRole}
                disabled={disabled}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {opt.desc}
                </div>
              </div>
            </label>
          );
        })}

        {state.status === "error" ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        ) : null}
        {state.status === "ok" ? (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}

        <SubmitButton />

        {!viewerIsOwner ? (
          <p className="text-xs text-muted-foreground">
            Note: only an Admin can promote / demote other Admins.
          </p>
        ) : null}
      </form>
    </section>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save role"}
    </Button>
  );
}
