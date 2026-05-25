"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  deleteDailySaleAction,
  upsertDailySaleAction,
  type FormState,
} from "./actions";

const initial: FormState = { status: "idle" };

export function DailySaleRowForm({
  locationId,
  businessDate,
  initialGross,
  initialNotes,
}: {
  locationId: string;
  businessDate: string;
  initialGross: string;
  initialNotes: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    upsertDailySaleAction,
    initial,
  );
  // Stable key per (location, date) so React re-mounts the row cleanly
  // when the parent week changes; the input's defaultValue then refreshes.
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="businessDate" value={businessDate} />
      <span className="font-mono tabular-nums text-xs text-muted-foreground sm:w-24">
        {businessDate}
      </span>
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          name="grossSales"
          defaultValue={initialGross}
          placeholder="0.00"
          required
          className="h-8 w-32 text-right text-sm"
        />
      </div>
      <Input
        name="notes"
        defaultValue={initialNotes ?? ""}
        placeholder="Notes (optional)"
        className="h-8 flex-1 min-w-[120px] text-sm"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </Button>
      {initialGross !== "" && (
        <form action={deleteDailySaleAction} className="contents">
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="businessDate" value={businessDate} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-[color:var(--destructive)]"
          >
            Clear
          </Button>
        </form>
      )}
      {state.status === "ok" && (
        <span className="text-xs text-emerald-600">Saved</span>
      )}
      {state.status === "error" && (
        <span className="text-xs text-[color:var(--destructive)]">
          {state.fieldErrors?.grossSales?.[0] ?? state.message}
        </span>
      )}
    </form>
  );
}
