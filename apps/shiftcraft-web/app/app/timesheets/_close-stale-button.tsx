"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { closeStaleClockInsAction } from "./event-actions";

// Manual trigger for the auto clock-out sweep. Closes any forgotten clock-ins
// where the scheduled shift started 24h+ ago, at that shift's scheduled end.
export function CloseStaleClockInsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function onClick() {
    if (
      !window.confirm(
        "Clock out anyone still on the clock 24h+ after their scheduled start? They'll be clocked out at their scheduled shift end.",
      )
    )
      return;
    setMsg(null);
    startTransition(async () => {
      const res = await closeStaleClockInsAction();
      if (!res.ok) {
        setMsg(res.message ?? "Couldn't run the sweep.");
        return;
      }
      const parts = [`Closed ${res.closed}`];
      if (res.skipped > 0) parts.push(`${res.skipped} skipped (locked/invalid)`);
      setMsg(
        res.closed === 0 && res.skipped === 0
          ? "Nothing to close — no stale clock-ins."
          : parts.join(" · "),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        variant="outline"
        size="sm"
      >
        {pending ? "Closing…" : "Close stale clock-ins"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
