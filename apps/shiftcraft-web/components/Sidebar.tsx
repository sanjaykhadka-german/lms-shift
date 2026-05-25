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
  DollarSign,
  FileText,
  FolderOpen,
  Hand,
  Heart,
  History,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  MapPin,
  Megaphone,
  Menu,
  Repeat,
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
import { friendlyRoleLabel } from "~/lib/roles";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { signOutAction } from "~/app/app/_actions";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
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
      { href: "/app/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    label: "My work",
    items: [
      { href: "/app/clock", label: "Time clock", icon: Clock },
      { href: "/app/my-shifts", label: "Shifts", icon: CalendarCheck },
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
      { href: "/app/timesheets", label: "Timesheets", icon: ClipboardList },
      { href: "/app/admin/daily-sales", label: "Daily sales", icon: DollarSign },
      { href: "/app/admin/kiosks", label: "Kiosks", icon: Tablet },
      { href: "/app/admin/leave-types", label: "Leave types", icon: Tag },
      { href: "/app/admin/manager-scopes", label: "Manager scopes", icon: ShieldCheck },
      { href: "/app/admin/skills", label: "Skills", icon: Sparkles },
      { href: "/app/admin/webhooks", label: "Webhooks", icon: Webhook },
      { href: "/app/admin/settings", label: "Workspace settings", icon: Sliders },
      { href: "/app/audit", label: "Audit log", icon: History },
    ],
  },
];

export function Sidebar({
  name,
  email,
  image,
  role,
}: {
  name: string;
  email: string;
  image: string | null;
  role: string;
}) {
  const pathname = usePathname();
  const isAdmin = role === "admin" || role === "owner";
  const sections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

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
      <div className="flex items-center justify-between border-b border-border px-5 py-6">
        <Logo size="sm" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="md:hidden rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
              sectionIdx > 0 && "mt-2 border-t border-border/60 pt-2",
            )}
          >
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                  <span className="flex-1">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-3 py-4">
        <div className="mb-2 flex items-center gap-3 px-3">
          <Avatar
            name={name}
            email={email}
            image={image}
            sizeClass="h-9 w-9"
            textClass="text-xs"
          />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Signed in as
            </div>
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="text-[11px] text-muted-foreground">
              {friendlyRoleLabel(role)}
            </div>
          </div>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size="sm" />
        <div className="w-7" aria-hidden />
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
          "md:hidden fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-hidden={!open}
      >
        {drawerContents}
      </aside>

      {/* Desktop sidebar — unchanged from before, just hidden on small. */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:border-r md:border-border md:bg-card">
        {drawerContents}
      </aside>
    </>
  );
}
