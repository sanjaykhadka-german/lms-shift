"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Dialog shell for the intercepted shift editor. Dismisses on backdrop click,
// the close button, or Escape — all via router.back(), which unwinds the
// interception and returns to the schedule grid (the URL also reverts).
export function ShiftModal({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    document.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [router]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit shift"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) router.back();
      }}
    >
      <div className="relative my-2 w-full max-w-3xl rounded-xl border border-border bg-[var(--paper)] p-6 shadow-2xl">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-[var(--paper-2)] hover:text-ink"
        >
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
        {children}
      </div>
    </div>
  );
}
