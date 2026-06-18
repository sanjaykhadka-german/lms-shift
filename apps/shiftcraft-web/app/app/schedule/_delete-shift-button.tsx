"use client";

import { useState, useTransition } from "react";
import { Button } from "~/components/ui/button";
import { deleteShiftAction } from "./actions";

// Client delete button for the shift editor. Used in both the intercepted
// @modal route and the standalone edit page. After deleting, hard-navigate to
// the schedule list: a soft router.push/refresh re-renders the (now-deleted)
// edit route, whose notFound() throws the 404 page. A full navigation avoids
// that stale re-render entirely; the action's revalidatePath keeps data fresh.
export function DeleteShiftButton({ shiftId }: { shiftId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!window.confirm("Delete this shift? This can't be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteShiftAction(shiftId);
      if (!res.ok) {
        setError(res.message ?? "Couldn't delete that shift.");
        return;
      }
      window.location.assign("/app/schedule");
    });
  }

  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <Button
        type="button"
        onClick={onDelete}
        disabled={pending}
        variant="outline"
        size="sm"
        className="border-destructive/40 text-destructive hover:bg-destructive/10"
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
