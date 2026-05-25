"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createSubscriptionAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

export function CreateSubscriptionForm({
  events,
}: {
  events: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(
    createSubscriptionAction,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto]"
    >
      <div className="space-y-1.5">
        <Label htmlFor="event">Event</Label>
        <select
          id="event"
          name="event"
          required
          defaultValue={events[0] ?? ""}
          className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
        >
          {events.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        {state.status === "error" && state.fieldErrors?.event && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.event[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="url">Target URL</Label>
        <Input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://example.com/webhooks/shiftcraft"
          required
          maxLength={2000}
        />
        {state.status === "error" && state.fieldErrors?.url && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.fieldErrors.url[0]}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="label">Label (optional)</Label>
        <Input id="label" name="label" placeholder="Internal name" maxLength={80} />
      </div>

      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>

      {state.status === "ok" && (
        <p className="sm:col-span-4 text-xs text-emerald-600">
          {state.message}
        </p>
      )}
      {state.status === "error" && !state.fieldErrors && (
        <p className="sm:col-span-4 text-xs text-[color:var(--destructive)]">
          {state.message}
        </p>
      )}
    </form>
  );
}
