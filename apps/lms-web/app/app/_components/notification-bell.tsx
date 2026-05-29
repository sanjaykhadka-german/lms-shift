"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

interface FeedResponse {
  unreadCount: number;
  items: NotificationItem[];
}

const POLL_INTERVAL_MS = 30_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  const [feed, setFeed] = React.useState<FeedResponse>({ unreadCount: 0, items: [] });
  const [open, setOpen] = React.useState(false);

  const fetchFeed = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as FeedResponse;
      setFeed(data);
    } catch {
      // network blip — try again on next tick
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchFeed is async; setState lands after await; linter traces through useCallback. Initial poll on mount is intentional.
    fetchFeed();
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      fetchFeed();
    };
    const handle = window.setInterval(tick, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchFeed();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchFeed]);

  const markRead = React.useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await fetchFeed();
    },
    [fetchFeed],
  );

  const markAllRead = React.useCallback(async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await fetchFeed();
  }, [fetchFeed]);

  const badgeText = feed.unreadCount === 0 ? null : feed.unreadCount > 9 ? "9+" : String(feed.unreadCount);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${badgeText ? ` (${badgeText} unread)` : ""}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {badgeText && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--primary)] px-1 text-[10px] font-medium text-[color:var(--primary-foreground)]">
              {badgeText}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {feed.unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {feed.items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-[color:var(--muted-foreground)]">
              You&rsquo;re all caught up.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {feed.items.map((n) => {
                const unread = !n.readAt;
                const inner = (
                  <div className={`flex items-start gap-2 px-3 py-2 text-sm ${unread ? "bg-[color:var(--secondary)]/30" : ""}`}>
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-[color:var(--primary)]" : "bg-transparent"}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{n.title}</p>
                      {n.body && (
                        <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">{n.body}</p>
                      )}
                      <p className="mt-0.5 text-[10px] text-[color:var(--muted-foreground)]">
                        {timeAgo(n.createdAt)}
                      </p>
                    </div>
                  </div>
                );
                const onActivate = () => {
                  if (unread) markRead([n.id]);
                  setOpen(false);
                };
                return (
                  <li key={n.id}>
                    {n.actionUrl ? (
                      <Link
                        href={n.actionUrl}
                        onClick={onActivate}
                        className="block hover:bg-[color:var(--secondary)]"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={onActivate}
                        className="block w-full text-left hover:bg-[color:var(--secondary)]"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
