import Link from "next/link";
import { requirePlatformAdmin } from "~/lib/auth/platform";
import { siteConfig } from "~/lib/site-config";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/platform"
              className="text-sm font-semibold tracking-tight"
            >
              {siteConfig.name} <span className="text-[color:var(--muted-foreground)]">Platform</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/platform/tenants"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
              >
                Tenants
              </Link>
              <Link
                href="/platform/audit"
                className="rounded-md px-3 py-1.5 text-sm font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
              >
                Audit
              </Link>
            </nav>
          </div>
          <Link
            href="/app"
            className="text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"
          >
            ← Back to app
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
