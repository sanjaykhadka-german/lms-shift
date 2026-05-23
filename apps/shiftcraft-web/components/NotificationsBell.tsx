"use client";

import Link from "next/link";
import { Bell } from "lucide-react";

// Global chrome bell. Renders the unread count as a red badge over the
// icon and links to /app/notifications when clicked. The unread count is
// computed server-side in app/app/layout.tsx and passed in as a prop —
// no client fetching, no polling. A future richer dropdown (last N
// notifications + 'See all →') can replace the <Link> with a disclosure.

export function NotificationsBell({ unreadCount }: { unreadCount: number }) {
  const safe = Math.max(0, Math.floor(unreadCount));
  const label =
    safe === 0
      ? "Notifications"
      : `Notifications, ${safe} unread`;
  return (
    <Link
      href="/app/notifications"
      aria-label={label}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <Bell className="h-5 w-5" strokeWidth={2} />
      {safe > 0 ? (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none tabular-nums text-white"
        >
          {safe > 99 ? "99+" : safe}
        </span>
      ) : null}
    </Link>
  );
}
