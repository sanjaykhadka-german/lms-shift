// Flat list of navigable "modules" (app sections/pages) used by the global
// search bar so users can jump straight to a page by name. Mirrors the
// SECTIONS array in components/Sidebar.tsx — kept as plain data (no icons /
// client deps) so it can be imported into the server-side search route.
// Keep the two in sync when adding or moving a nav item.
//
// `adminOnly` matches the section-level gate in Sidebar: only the "Admin"
// section is manager-gated; everything else is visible to all members.

export type NavModule = {
  label: string;
  href: string;
  adminOnly?: boolean;
};

export const NAV_MODULES: NavModule[] = [
  // Overview
  { label: "Dashboard", href: "/app" },
  { label: "Schedule", href: "/app/schedule" },
  { label: "Timesheets", href: "/app/timesheets", adminOnly: true },
  { label: "Announcements", href: "/app/announcements" },
  // My work
  { label: "My profile", href: "/app/welcome" },
  { label: "Time clock", href: "/app/clock" },
  { label: "Shifts", href: "/app/my-shifts" },
  { label: "Calendar", href: "/app/calendar" },
  { label: "Availability", href: "/app/availability" },
  { label: "Time off", href: "/app/time-off" },
  { label: "Open shifts", href: "/app/open-shifts" },
  // People
  { label: "Team members", href: "/app/people/team" },
  { label: "New hire onboarding", href: "/app/people/onboarding" },
  { label: "Document library", href: "/app/people/documents" },
  { label: "Team documents", href: "/app/people/team-documents" },
  { label: "Culture", href: "/app/people/culture" },
  // Workspace
  { label: "Locations", href: "/app/locations" },
  { label: "Tasks", href: "/app/tasks" },
  { label: "Settings", href: "/app/settings" },
  // Admin (manager-gated)
  { label: "Reports", href: "/app/reports", adminOnly: true },
  { label: "Departments", href: "/app/departments", adminOnly: true },
  { label: "Shift templates", href: "/app/shift-templates", adminOnly: true },
  { label: "Swap requests", href: "/app/swaps", adminOnly: true },
  { label: "Coverage gaps", href: "/app/coverage-gaps", adminOnly: true },
  { label: "Daily sales", href: "/app/admin/daily-sales", adminOnly: true },
  { label: "Doc expiry digest", href: "/app/admin/documents-expiring", adminOnly: true },
  { label: "Kiosks", href: "/app/admin/kiosks", adminOnly: true },
  { label: "Visitors", href: "/app/admin/visitors", adminOnly: true },
  { label: "Leave types", href: "/app/admin/leave-types", adminOnly: true },
  { label: "Access scopes", href: "/app/admin/manager-scopes", adminOnly: true },
  { label: "Payroll (Xero)", href: "/app/admin/payroll", adminOnly: true },
  { label: "Skills", href: "/app/admin/skills", adminOnly: true },
  { label: "Webhooks", href: "/app/admin/webhooks", adminOnly: true },
  { label: "Workspace settings", href: "/app/admin/settings", adminOnly: true },
  { label: "Billing", href: "/app/billing", adminOnly: true },
  { label: "Audit log", href: "/app/audit", adminOnly: true },
];
