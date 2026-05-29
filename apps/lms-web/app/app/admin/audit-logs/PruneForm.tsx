"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "~/components/ui/button";
import { pruneAuditLogsAction } from "./actions";

export function PruneForm() {
  const [days, setDays] = useState("365");

  return (
    <form
      action={pruneAuditLogsAction}
      onSubmit={(e) => {
        const n = Number(days);
        if (!Number.isFinite(n) || n < 30) {
          e.preventDefault();
          alert("Retention must be at least 30 days.");
          return;
        }
        if (
          !confirm(
            `Permanently delete all audit log rows older than ${n} days? This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-2"
    >
      <label
        htmlFor="prune-days"
        className="text-sm text-[color:var(--muted-foreground)]"
      >
        Retain
      </label>
      <input
        id="prune-days"
        name="days"
        type="number"
        min={30}
        step={1}
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className="h-9 w-20 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-2 text-sm"
      />
      <span className="text-sm text-[color:var(--muted-foreground)]">days</span>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Pruning…" : "Prune older logs"}
    </Button>
  );
}
