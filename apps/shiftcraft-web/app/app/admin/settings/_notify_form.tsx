"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { setNotifyChannelAction, type SettingsFormState } from "./actions";
import type { NotifyChannel } from "~/lib/notify-prefs";

const INITIAL: SettingsFormState = { status: "idle" };

const OPTIONS: Array<{ value: NotifyChannel; label: string; hint: string }> = [
  {
    value: "both",
    label: "Email and in-app",
    hint: "Send both an email and an in-app notification (with push if installed).",
  },
  {
    value: "in_app",
    label: "In-app only",
    hint: "Only in-app notifications + push. No emails for shifts.",
  },
  {
    value: "email",
    label: "Email only",
    hint: "Only emails. No in-app notifications for shifts.",
  },
];

export function NotifyChannelForm({ current }: { current: NotifyChannel }) {
  const [state, formAction] = useActionState(setNotifyChannelAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/40 cursor-pointer"
        >
          <input
            type="radio"
            name="channel"
            value={opt.value}
            defaultChecked={opt.value === current}
            className="mt-1"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{opt.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{opt.hint}</div>
          </div>
        </label>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <SubmitButton />
        {state.status === "ok" ? (
          <p className="text-xs text-[var(--live)]">{state.message}</p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-xs text-[color:var(--destructive)]">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save notifications"}
    </Button>
  );
}
