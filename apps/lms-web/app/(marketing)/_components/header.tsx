import Link from "next/link";
import { currentUser } from "~/lib/auth/current";
import { Button } from "~/components/ui/button";
import { siteConfig } from "~/lib/site-config";

export async function Header() {
  const signedIn = !!(await currentUser());

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[color:var(--border)] bg-[color:var(--background)]/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
        <Link href="/" className="flex items-center" aria-label={siteConfig.name}>
          <span
            className="text-[2.7rem] leading-none tracking-tight"
            style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
          >
            tr<span className="text-[color:var(--primary)]">a</span>cey
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="#features"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            Features
          </Link>
          <Link
            href="#pricing"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            Pricing
          </Link>
          <Link
            href="#faq"
            className="hidden text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)] sm:inline"
          >
            FAQ
          </Link>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/app">Open app</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
