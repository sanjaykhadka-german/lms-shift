import Link from "next/link";
import { Logo } from "~/components/Logo";
import { Button } from "~/components/ui/button";

// Global 404. Next renders this inside the root layout for any unmatched route
// (and any notFound() call without a closer not-found boundary). Always gives
// the user a way back — the default Next 404 has no navigation.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
      <Logo size="sm" />
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-ink-3">
          Error 404
        </p>
        <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
        <p className="max-w-sm text-sm text-ink-2">
          The page you’re looking for doesn’t exist or may have been moved.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="sm">
          <Link href="/app">Back to dashboard</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/schedule">Go to schedule</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
