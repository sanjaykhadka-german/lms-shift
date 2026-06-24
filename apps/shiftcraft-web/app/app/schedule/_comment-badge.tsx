"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

// Internal-comment indicator for a shift chip. Shows a 💬 when the shift has
// comments; hovering (or focusing) it reveals the latest comment (author +
// body) and a "+N earlier" count, so a manager can read the internal note
// without opening the shift.
//
// The popover is PORTALED to <body> with fixed positioning rather than rendered
// as an absolutely-positioned child: the roster grid lives inside an
// `overflow-x-auto` container, which would clip an in-flow popover. Portaling +
// position:fixed lets it float outside that box. Comments are manager-only and
// only loaded for admins server-side, so this never renders for staff.
export function CommentBadge({
  count,
  latest,
  author,
}: {
  count?: number;
  latest?: string | null;
  author?: string | null;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  if (!count || count <= 0 || !latest) return null;

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip below when there isn't room above (near the top of the viewport).
    const below = r.top < 160;
    setPos({
      left: r.left + r.width / 2,
      top: below ? r.bottom + 8 : r.top - 8,
      below,
    });
  }
  const hide = () => setPos(null);

  return (
    <span
      ref={ref}
      className="inline-flex shrink-0 items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span
        tabIndex={0}
        aria-label="Has internal comments"
        className="cursor-default text-[11px] leading-none"
      >
        💬
      </span>
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[100] w-64"
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.below
                  ? "translate(-50%, 0)"
                  : "translate(-50%, -100%)",
              }}
            >
              <div className="rounded-md border border-border bg-card p-2 text-left shadow-2xl">
                {author ? (
                  <div className="text-[10px] font-semibold text-ink">
                    {author}
                  </div>
                ) : null}
                <div className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-ink-2">
                  {latest}
                </div>
                {count > 1 ? (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    +{count - 1} earlier
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
