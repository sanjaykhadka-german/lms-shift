"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { updateMyAvailabilityAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export function AvailabilityForm({
  initialAvailability,
}: {
  initialAvailability: Record<string, string> | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateMyAvailabilityAction,
    initial,
  );

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Tell managers when you can typically work each day. Free text per day
        — e.g. "9-5", "evenings only", "after 4pm", "not available". Leave a
        day blank if you'd rather not say.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {WEEKDAYS.map((d) => (
          <div key={d.key} className="space-y-1">
            <Label htmlFor={`availability_${d.key}`}>{d.label}</Label>
            <Input
              id={`availability_${d.key}`}
              name={`availability_${d.key}`}
              defaultValue={initialAvailability?.[d.key] ?? ""}
              placeholder="—"
              maxLength={80}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save availability"}
        </Button>
        {state.status === "ok" && (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        )}
        {state.status === "error" && (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
