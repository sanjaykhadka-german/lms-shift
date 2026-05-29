"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "~/lib/utils";
import { Logo } from "./Logo";
import { signOutAction } from "~/app/app/_actions";

const NAV = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
];

export function Sidebar({ name, role }: { name: string; role: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-6">
        <Logo size="sm" />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
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
      </nav>
      <div className="border-t border-border px-3 py-4">
        <div className="mb-2 px-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Signed in as
          </div>
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="text-[11px] capitalize text-muted-foreground">{role}</div>
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
    </aside>
  );
}
