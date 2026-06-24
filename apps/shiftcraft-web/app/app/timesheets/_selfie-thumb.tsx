"use client";

// Clock-in/out selfie thumbnail with hover-to-enlarge (item 8). The small
// thumbnail stays inline in the segment chip; hovering (or focusing) it pops a
// larger view above it so a manager can verify who actually punched without
// leaving the page. Pure CSS group-hover — no JS state, no extra fetch (same
// /api/kiosk-selfie/<id> source, just rendered bigger). The popover is
// pointer-events-none so it never blocks the controls underneath.
export function SelfieThumb({ eventId }: { eventId: string }) {
  const src = `/api/kiosk-selfie/${eventId}`;
  return (
    <span className="group/selfie relative inline-block align-middle">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Clock-in photo"
        width={32}
        height={24}
        tabIndex={0}
        className="h-6 w-8 cursor-zoom-in rounded-sm border border-border object-cover"
      />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 group-hover/selfie:block group-focus-within/selfie:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Clock-in photo"
          className="h-40 w-auto max-w-[240px] rounded-md border border-border bg-card shadow-2xl"
        />
      </span>
    </span>
  );
}
