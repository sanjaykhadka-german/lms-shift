"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { LiveClock } from "./LiveClock";
import { ThemeToggle } from "./ThemeToggle";

// Route → human title. Longest-prefix match wins, so nested routes inherit
// their section title unless they have a more specific entry.
const TITLES: Record<string, string> = {
  "/app": "Dashboard",
  "/app/schedule": "Schedule",
  "/app/announcements": "Announcements",
  "/app/welcome": "My profile",
  "/app/clock": "Time clock",
  "/app/my-shifts": "My shifts",
  "/app/calendar": "Calendar",
  "/app/availability": "Availability",
  "/app/time-off": "Time off",
  "/app/open-shifts": "Open shifts",
  "/app/people/team": "Team members",
  "/app/people/onboarding": "New hire onboarding",
  "/app/people/documents": "Document library",
  "/app/people/team-documents": "Team documents",
  "/app/people/culture": "Culture",
  "/app/locations": "Locations",
  "/app/tasks": "Tasks",
  "/app/settings": "Settings",
  "/app/reports": "Reports",
  "/app/departments": "Departments",
  "/app/shift-templates": "Shift templates",
  "/app/swaps": "Swap requests",
  "/app/coverage-gaps": "Coverage gaps",
  "/app/timesheets": "Timesheets",
  "/app/admin/daily-sales": "Daily sales",
  "/app/admin/documents-expiring": "Doc expiry digest",
  "/app/admin/kiosks": "Kiosks",
  "/app/admin/leave-types": "Leave types",
  "/app/admin/manager-scopes": "Manager scopes",
  "/app/admin/payroll": "Payroll",
  "/app/admin/skills": "Skills",
  "/app/admin/webhooks": "Webhooks",
  "/app/admin/settings": "Workspace settings",
  "/app/audit": "Audit log",
};

function titleFor(pathname: string): string {
  let bestLen = -1;
  let bestTitle = "";
  for (const [key, title] of Object.entries(TITLES)) {
    if ((pathname === key || pathname.startsWith(key + "/")) && key.length > bestLen) {
      bestLen = key.length;
      bestTitle = title;
    }
  }
  if (bestTitle) return bestTitle;
  // Fallback: humanise the last path segment.
  const seg = pathname.split("/").filter(Boolean).pop() ?? "ShiftCraft";
  return seg.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function TopBar({
  tenantName,
  bell,
}: {
  tenantName?: string | null;
  bell?: React.ReactNode;
}) {
  const pathname = usePathname();
  const title = titleFor(pathname);

  return (
    <header className="sticky top-0 z-30 hidden h-16 items-center gap-4 border-b border-line bg-[color-mix(in_srgb,var(--bone)_82%,transparent)] px-7 backdrop-blur-md md:flex">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {tenantName && (
          <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
            {tenantName}
          </div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <LiveClock />
        {bell}
        <ThemeToggle />
      </div>
    </header>
  );
}
