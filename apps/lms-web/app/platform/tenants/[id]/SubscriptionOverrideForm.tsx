"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  extendTenantTrialAction,
  forceTenantStatusAction,
  type PlatformOverrideState,
} from "./actions";

const initial: PlatformOverrideState = { status: "idle" };

interface Props {
  tenantId: string;
  currentStatus: string;
}

export function SubscriptionOverrideForm({ tenantId, currentStatus }: Props) {
  const [statusState, statusAction, statusPending] = useActionState(
    forceTenantStatusAction,
    initial,
  );
  const [trialState, trialAction, trialPending] = useActionState(
    extendTenantTrialAction,
    initial,
  );

  return (
    <div className="space-y-6">
      <form action={statusAction} className="space-y-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="space-y-1.5">
          <Label htmlFor="status">Override billing status</Label>
          <select
            id="status"
            name="status"
            defaultValue={currentStatus}
            className="block h-9 w-full max-w-sm rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
          >
            <option value="trialing">trialing</option>
            <option value="active">active</option>
            <option value="past_due">past_due</option>
            <option value="canceled">canceled</option>
          </select>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Bypasses Stripe. A future webhook delivery (e.g.
            <code className="mx-1">customer.subscription.updated</code>) will
            overwrite this — use only for local dev, comp accounts, or
            recovering from a webhook miss. Every change writes an audit event.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={statusPending} variant="outline">
            {statusPending ? "Saving…" : "Override status"}
          </Button>
          {statusState.status === "ok" && (
            <p className="text-xs text-emerald-600">{statusState.message}</p>
          )}
          {statusState.status === "error" && (
            <p className="text-xs text-[color:var(--destructive)]">{statusState.message}</p>
          )}
        </div>
      </form>

      <form action={trialAction} className="space-y-3">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="space-y-1.5">
          <Label htmlFor="days">Extend trial</Label>
          <div className="flex items-center gap-2">
            <input
              id="days"
              name="days"
              type="number"
              min={1}
              max={365}
              defaultValue={30}
              className="h-9 w-24 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
            />
            <span className="text-sm text-[color:var(--muted-foreground)]">days from now</span>
          </div>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Sets <code>trial_ends_at = now() + N days</code>. Status is
            untouched — works alongside the dropdown above.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={trialPending} variant="outline">
            {trialPending ? "Extending…" : "Extend trial"}
          </Button>
          {trialState.status === "ok" && (
            <p className="text-xs text-emerald-600">{trialState.message}</p>
          )}
          {trialState.status === "error" && (
            <p className="text-xs text-[color:var(--destructive)]">{trialState.message}</p>
          )}
        </div>
      </form>
    </div>
  );
}
