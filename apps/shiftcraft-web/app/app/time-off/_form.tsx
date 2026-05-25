"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { submitTimeOffAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

export interface LeaveTypeChoice {
  id: string;
  name: string;
}

export function TimeOffForm({
  leaveTypes,
}: {
  leaveTypes: LeaveTypeChoice[];
}) {
  const [state, formAction, pending] = useActionState(submitTimeOffAction, initial);
  const noTypes = leaveTypes.length === 0;
  const defaultLeaveTypeId = leaveTypes[0]?.id ?? "";

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="leaveTypeId">Leave type</Label>
        <select
          id="leaveTypeId"
          name="leaveTypeId"
          required
          defaultValue={defaultLeaveTypeId}
          disabled={noTypes}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {noTypes ? (
            <option value="">No leave types — ask an admin</option>
          ) : (
            leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))
          )}
        </select>
        {state.status === "error" && state.fieldErrors?.leaveTypeId && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.leaveTypeId[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="startDate">Start date</Label>
        <Input id="startDate" name="startDate" type="date" required />
        {state.status === "error" && state.fieldErrors?.startDate && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.startDate[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="endDate">End date</Label>
        <Input id="endDate" name="endDate" type="date" required />
        {state.status === "error" && state.fieldErrors?.endDate && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.endDate[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="reason">Reason (optional)</Label>
        <textarea
          id="reason"
          name="reason"
          rows={3}
          placeholder="A short note for your manager"
          className="flex w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending || noTypes}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-emerald-600">{state.message}</p>
        )}
        {state.status === "error" && !state.fieldErrors && (
          <p className="text-xs text-[color:var(--destructive)]">{state.message}</p>
        )}
      </div>
    </form>
  );
}
