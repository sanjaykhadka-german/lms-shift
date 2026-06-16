"use client";

import { useEffect } from "react";
import { Button } from "~/components/ui/button";

// Route-level error boundary for /app/schedule (and its modal/edit children).
// A failing data query — e.g. the employee-view assignment fetch — degrades
// to a readable message + retry instead of a blank 500. `reset()` re-renders
// the segment, re-running the server component.
export default function ScheduleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the stack in the server/dev console for debugging; the digest
    // links a prod error back to the server log line.
    console.error("[schedule] render error", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">
        Couldn’t load the schedule
      </h1>
      <p className="mt-2 text-sm text-ink-2">
        Something went wrong while loading this view. You can retry, or switch
        back to a different view.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-[11px] text-ink-3">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-6 flex items-center justify-center gap-2">
        <Button onClick={() => reset()} size="sm">
          Try again
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/app/schedule">Reset to default view</a>
        </Button>
      </div>
    </div>
  );
}
