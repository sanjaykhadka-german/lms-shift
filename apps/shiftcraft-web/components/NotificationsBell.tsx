"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

// Global chrome bell with a click-to-open preview dropdown.
//
// The layout fetches the unread count + last N notifications server-side
// (see getUnreadCount + getRecentNotifications in lib/notifications-feed)
// and passes them in as props. No client-side polling — the count is
// fresh on every page navigation and refresh.
//
// Items link to their actionUrl (when present) or /app/notifications.
// Footer 'See all' link goes to the full page.

export interface NotificationPreview {
  id: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAtIso: string;
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell({
  unreadCount,
  recent,
}: {
  unreadCount: number;
  recent: NotificationPreview[];
}) {
  const safe = Math.max(0, Math.floor(unreadCount));
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    safe === 0 ? "Notifications" : `Notifications, ${safe} unread`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
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
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notifications
            </span>
            {safe > 0 ? (
              <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                {safe} unread
              </span>
            ) : null}
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className={n.readAt ? "" : "bg-rose-500/5"}
                >
                  <Link
                    href={n.actionUrl ?? "/app/notifications"}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-2 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt ? (
                        <span
                          aria-hidden
                          className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-rose-600"
                        />
                      ) : (
                        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {n.title}
                        </div>
                        {n.body ? (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {n.body}
                          </p>
                        ) : null}
                        <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                          {fmtRelative(n.createdAtIso)}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border px-3 py-2 text-right">
            <Link
              href="/app/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-primary hover:underline"
            >
              See all →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
