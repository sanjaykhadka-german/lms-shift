"use client";

// Internal-comment indicator for a shift chip. Shows a 💬 when the shift has
// comments; hovering (or focusing) reveals the latest one — author + body —
// plus a "+N earlier" count, so a manager sees the internal note without
// opening the shift. Comments are manager-only and are only loaded for admins
// server-side, so this never renders for staff. Pure CSS group-hover, mirrors
// the SelfieThumb popover; pointer-events-none so it doesn't block the chip.
export function CommentBadge({
  count,
  latest,
  author,
}: {
  count?: number;
  latest?: string | null;
  author?: string | null;
}) {
  if (!count || count <= 0 || !latest) return null;
  return (
    <span className="group/comment relative inline-flex shrink-0 items-center">
      <span
        tabIndex={0}
        aria-label="Has internal comments"
        className="cursor-default text-[11px] leading-none"
      >
        💬
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-64 -translate-x-1/2 group-hover/comment:block group-focus-within/comment:block">
        <span className="block rounded-md border border-border bg-card p-2 text-left shadow-2xl">
          {author ? (
            <span className="block text-[10px] font-semibold text-ink">
              {author}
            </span>
          ) : null}
          <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-snug text-ink-2">
            {latest}
          </span>
          {count > 1 ? (
            <span className="mt-1 block text-[10px] text-muted-foreground">
              +{count - 1} earlier
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}
