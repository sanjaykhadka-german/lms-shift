"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

// Clock-in/out selfie thumbnail with hover-to-enlarge. Used on the timesheets
// expansion/detail panel and the Kiosks "Recent punches" list. The enlarged
// view is PORTALED to <body> with fixed positioning (computed from the thumb's
// rect, flips below when near the top) so it floats outside any overflow-hidden
// / overflow-x-auto ancestor instead of being clipped. Same source as the
// thumbnail (/api/kiosk-selfie/<clockEventId>), just rendered bigger.
export function SelfieThumb({
  eventId,
  thumbClassName,
}: {
  eventId: string;
  /** Inline thumbnail sizing/look. Defaults to the small timesheets chip size. */
  thumbClassName?: string;
}) {
  const src = `/api/kiosk-selfie/${eventId}`;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);

  const thumb =
    thumbClassName ?? "h-6 w-8 rounded-sm border border-border object-cover";

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 200; // not enough room above → show below
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Clock-in photo"
        tabIndex={0}
        className={`cursor-zoom-in ${thumb}`}
      />
      {pos && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[100]"
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.below
                  ? "translate(-50%, 0)"
                  : "translate(-50%, -100%)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="Clock-in photo"
                className="h-40 w-auto max-w-[260px] rounded-md border border-border bg-card shadow-2xl"
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
