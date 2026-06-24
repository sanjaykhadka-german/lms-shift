"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  BarChart3,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  ClipboardList,
  Clock,
  DoorOpen,
  DollarSign,
  FileText,
  FolderOpen,
  Hand,
  Heart,
  History,
  KanbanSquare,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  Plane,
  Receipt,
  CreditCard,
  Repeat,
  Scale,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tablet,
  Tag,
  UserPlus,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  friendlyRoleLabel,
  isAtLeastManager,
  isLead,
  isWorkspaceAdmin,
} from "~/lib/roles";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { signOutAction } from "~/app/app/_actions";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  // Hidden from Location Managers — owner/Manager-only surfaces (billing,
  // workspace-wide config, integrations). Location Managers see the rest of
  // the Admin section, scoped to their location(s).
  ownerOnly?: boolean;
  // Manager-gated item living in a section that isn't itself admin-only (e.g.
  // Timesheets pinned under Schedule in Overview). Hidden from regular staff.
  adminOnly?: boolean;
  // Also visible to the approve-only "Lead" tier (which isn't a manager). Used
  // alongside adminOnly so the item shows for managers AND leads, but not for
  // regular employees. Leads reach it read/approve-scoped to their area-team.
  approverOnly?: boolean;
};

type NavSection = {
  label: string;
  adminOnly?: boolean;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/app/timesheets", label: "Timesheets", icon: ClipboardList, adminOnly: true, approverOnly: true },
      { href: "/app/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "My work",
    items: [
      { href: "/app/welcome", label: "My profile", icon: UserPlus },
      { href: "/app/clock", label: "Time clock", icon: Clock },
      { href: "/app/my-shifts", label: "Shifts", icon: CalendarCheck },
      { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/app/availability", label: "Availability", icon: CalendarCheck },
      { href: "/app/time-off", label: "Time off", icon: CalendarOff },
      { href: "/app/open-shifts", label: "Open shifts", icon: Hand },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/app/people/team", label: "Team members", icon: Users },
      { href: "/app/people/onboarding", label: "New hire onboarding", icon: UserPlus },
      { href: "/app/people/documents", label: "Document library", icon: FolderOpen },
      { href: "/app/people/team-documents", label: "Team documents", icon: FileText },
      { href: "/app/people/culture", label: "Culture", icon: Heart },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/app/locations", label: "Locations", icon: MapPin },
      { href: "/app/areas", label: "Areas", icon: LayoutGrid },
      { href: "/app/tasks", label: "Tasks", icon: KanbanSquare },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { href: "/app/reports", label: "Reports", icon: BarChart3 },
      { href: "/app/departments", label: "Departments", icon: Building2 },
      { href: "/app/shift-templates", label: "Shift templates", icon: CalendarDays },
      { href: "/app/swaps", label: "Swap requests", icon: Repeat },
      { href: "/app/coverage-gaps", label: "Coverage gaps", icon: AlertCircle },
      { href: "/app/admin/clock-now", label: "Who's clocked in", icon: Clock },
      { href: "/app/admin/daily-sales", label: "Daily sales", icon: DollarSign },
      { href: "/app/admin/documents-expiring", label: "Doc expiry digest", icon: FileText },
      { href: "/app/admin/kiosks", label: "Kiosks", icon: Tablet },
      { href: "/app/admin/visitors", label: "Visitors", icon: DoorOpen },
      { href: "/app/admin/awards", label: "Award rates", icon: Scale, ownerOnly: true },
      { href: "/app/admin/leave-types", label: "Leave types", icon: Tag },
      { href: "/app/admin/leave", label: "Leave balances", icon: Plane },
      { href: "/app/admin/manager-scopes", label: "Access scopes", icon: ShieldCheck, ownerOnly: true },
      { href: "/app/admin/payroll", label: "Payroll (Xero)", icon: Receipt, ownerOnly: true },
      { href: "/app/admin/skills", label: "Skills", icon: Sparkles },
      { href: "/app/admin/webhooks", label: "Webhooks", icon: Webhook, ownerOnly: true },
      { href: "/app/admin/settings", label: "Workspace settings", icon: Sliders, ownerOnly: true },
      { href: "/app/billing", label: "Billing", icon: CreditCard, ownerOnly: true },
      { href: "/app/audit", label: "Audit log", icon: History },
    ],
  },
];

export function Sidebar({
  name,
  email,
  image,
  role,
  showPlatformLink = false,
}: {
  name: string;
  email: string;
  image: string | null;
  role: string;
  showPlatformLink?: boolean;
}) {
  const pathname = usePathname();
  // Location Managers see the Admin section too, but owner/Manager-only items
  // inside it (billing, workspace settings, integrations) are filtered out.
  const canSeeAdmin = isAtLeastManager(role);
  const fullAdmin = isWorkspaceAdmin(role);
  const leadRole = isLead(role);
  const sections = SECTIONS.filter((s) => !s.adminOnly || canSeeAdmin).map((s) => ({
    ...s,
    items: s.items.filter((item) => {
      if (item.ownerOnly && !fullAdmin) return false;
      if (item.adminOnly && !canSeeAdmin) {
        // A Lead isn't a manager, but approver items (Timesheets) still show.
        return Boolean(item.approverOnly && leadRole);
      }
      return true;
    }),
  }));

  // Mobile drawer state. Closes automatically on route change so the user
  // doesn't see the drawer linger across navigation. Esc closes it too.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const drawerContents = (
    <>
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-5">
        <Logo size="sm" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="md:hidden rounded-md p-1 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, sectionIdx) => (
          <div
            key={section.label}
            className={cn(
              "space-y-0.5",
              sectionIdx > 0 && "mt-2 border-t border-line-soft pt-2",
            )}
          >
            <div className="px-3 pb-1.5 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
              {section.label}
            </div>
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--ink)] text-[var(--paper)]"
                      : "text-ink-2 hover:bg-paper-2 hover:text-ink",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px]",
                      active ? "text-[var(--accent)]" : "text-ink-3 group-hover:text-ink",
                    )}
                    strokeWidth={2}
                  />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-line-soft px-3 py-4">
        {/* Cross-tenant platform surface — only shown to platform admins
            (PLATFORM_ADMIN_EMAILS). Lives outside the /app shell, so a plain
            full navigation rather than an in-app nav item. */}
        {showPlatformLink && (
          <Link
            href="/platform"
            className="mb-2 flex w-full items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <Building2 className="h-4 w-4" />
            Tracey Platform
          </Link>
        )}
        <div className="mb-2 flex items-center gap-3 px-3">
          <Avatar
            name={name}
            email={email}
            image={image}
            sizeClass="h-9 w-9"
            textClass="text-xs"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{name}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
              {friendlyRoleLabel(role)}
            </div>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-[var(--r-sm)] px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar — only visible below md. Lets the user open the
          drawer and shows the logo so the brand stays present. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--bone)_82%,transparent)] px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size="sm" />
        <ThemeToggle />
      </div>

      {/* Backdrop. Click anywhere outside the drawer to close. */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile drawer — slides in from the left when `open`. */}
      <aside
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-[var(--paper)] shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!open}
      >
        {drawerContents}
      </aside>

      {/* Desktop sidebar — 248px, paper surface, hidden on small. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-[248px] md:flex-col md:border-r md:border-line md:bg-[var(--paper)]">
        {drawerContents}
      </aside>
    </>
  );
}
