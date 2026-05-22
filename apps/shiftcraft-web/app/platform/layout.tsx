import Link from "next/link";
import { requirePlatformAdmin } from "~/lib/auth/platform";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gate everything under /platform/*. Returns 404 for non-admins so the
  // surface is invisible to the rest of the tenancy.
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/platform"
              className="text-sm font-semibold tracking-tight"
            >
              ShiftCraft{" "}
              <span className="text-muted-foreground">Platform</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/platform/tenants"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Tenants
              </Link>
              <Link
                href="/platform/audit"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Audit
              </Link>
            </nav>
          </div>
          <Link
            href="/app"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to app
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
