"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "~/components/ui/button";
import { deleteShiftAction } from "./actions";

// Client delete button for the shift editor. Used in both the intercepted
// @modal route and the standalone edit page. Navigates back to the schedule
// list itself after deleting — a server-side redirect() from inside the modal
// route lands on a 404, so the action just returns {ok} and we push here.
export function DeleteShiftButton({ shiftId }: { shiftId: string }) {
  const router = useRouter();
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
      router.push("/app/schedule");
      router.refresh();
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
