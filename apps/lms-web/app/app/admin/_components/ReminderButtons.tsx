"use client";

import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import {
  runAssignmentRemindersAction,
  runWhsRemindersAction,
} from "../_actions/reminders";

export function AssignmentReminderButton() {
  return (
    <form
      action={runAssignmentRemindersAction}
      onSubmit={(e) => {
        if (
          !confirm(
            "Send a reminder email to every employee with outstanding training?",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Submit label="Send pending-assignment reminders" />
    </form>
  );
}

export function WhsReminderButton() {
  return (
    <form
      action={runWhsRemindersAction}
      onSubmit={(e) => {
        const fd = new FormData(e.currentTarget);
        const force = fd.get("force") === "1";
        const msg = force
          ? "Send WHS expiry reminders now and IGNORE the 14-day cooldown? Every matching record will be re-emailed."
          : "Send WHS expiry reminders now? Records reminded in the last 14 days are skipped.";
        if (!confirm(msg)) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <Submit label="Send WHS expiry reminders" />
      <label className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)]">
        <input
          type="checkbox"
          name="force"
          value="1"
          className="h-3.5 w-3.5 rounded border-[color:var(--border)]"
        />
        Force (ignore 14-day cooldown)
      </label>
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Sending…" : label}
    </Button>
  );
}
