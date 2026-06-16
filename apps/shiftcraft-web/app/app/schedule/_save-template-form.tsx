"use client";

import { useActionState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { saveShiftAsTemplateAction, type FormState } from "./actions";

const initial: FormState = { status: "idle" };

// Inline "save this shift as a reusable template" control on the shift editor.
// Stays put (no navigation) — shows a confirmation message in place.
export function SaveTemplateForm({ shiftId }: { shiftId: string }) {
  const [state, formAction, pending] = useActionState(
    saveShiftAsTemplateAction,
    initial,
  );
  return (
    <form
      action={formAction}
      className="flex w-full flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
    >
      <input type="hidden" name="shiftId" value={shiftId} />
      <div className="min-w-[180px] flex-1 space-y-1">
        <label
          htmlFor="tpl-name"
          className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          Save as template
        </label>
        <Input
          id="tpl-name"
          name="name"
          placeholder="e.g. Weekday Butcher AM"
          required
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save template"}
      </Button>
      {state.status === "ok" && (
        <p className="w-full text-xs text-[var(--live)]">{state.message}</p>
      )}
      {state.status === "error" && (
        <p className="w-full text-xs text-[color:var(--destructive)]">
          {state.fieldErrors?.name?.[0] ?? state.message}
        </p>
      )}
    </form>
  );
}
