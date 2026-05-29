"use client";

// Cross-app launcher — the waffle-icon dropdown that appears in every app's
// header. Click to see the other apps in the suite and jump to them.
//
// Pure component: no data fetching, no auth — the caller passes in the list
// of apps the user has access to. That keeps the @tracey/ui package free of
// runtime dependencies on @tracey/db / @tracey/auth.
//
// Usage (e.g. in apps/lms-web/components/Header.tsx):
//
//   import { AppSwitcher } from "@tracey/ui";
//   import { APPS } from "~/lib/site-config";
//
//   <AppSwitcher
//     currentAppId="lms"
//     apps={[APPS.lms, APPS.shiftcraft]}
//     hubUrl={APPS.hub.url}
//   />

import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export interface AppSwitcherItem {
  id: string;
  name: string;
  tagline?: string;
  url: string;
}

export interface AppSwitcherProps {
  currentAppId: string;
  apps: AppSwitcherItem[];
  hubUrl?: string;
  className?: string;
}

export function AppSwitcher({ currentAppId, apps, hubUrl, className }: AppSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape — the minimum to feel non-broken without
  // pulling in @radix-ui/react-dropdown-menu just for this.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch app"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <WaffleIcon />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-popover p-2 shadow-lg"
        >
          <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Your apps
          </p>
          <ul className="space-y-1">
            {apps.map((app) => {
              const current = app.id === currentAppId;
              return (
                <li key={app.id}>
                  <a
                    href={app.url}
                    role="menuitem"
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-3 rounded-md px-2 py-2 text-sm transition-colors",
                      current
                        ? "bg-muted text-foreground"
                        : "hover:bg-muted text-foreground",
                    )}
                  >
                    <AppGlyph id={app.id} />
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {app.name}
                        {current ? (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                            Open
                          </span>
                        ) : null}
                      </span>
                      {app.tagline ? (
                        <span className="text-xs text-muted-foreground">{app.tagline}</span>
                      ) : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>

          {hubUrl ? (
            <div className="mt-2 border-t pt-2">
              <a
                href={hubUrl}
                role="menuitem"
                className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <HomeIcon />
                <span>Account &amp; billing</span>
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Tiny inline icons so this component has zero non-React deps ──

function WaffleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="1.6" />
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="19" cy="5" r="1.6" />
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
      <circle cx="5" cy="19" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
      <circle cx="19" cy="19" r="1.6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z" />
    </svg>
  );
}

function AppGlyph({ id }: { id: string }) {
  // First letter on a coloured tile — enough visual anchor without shipping
  // per-app SVG logos through this package.
  const letter = id.charAt(0).toUpperCase();
  const palette: Record<string, string> = {
    lms: "bg-emerald-600 text-white",
    shiftcraft: "bg-indigo-600 text-white",
    hub: "bg-slate-700 text-white",
  };
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
        palette[id] ?? "bg-slate-500 text-white",
      )}
    >
      {letter}
    </span>
  );
}
