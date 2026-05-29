import Link from "next/link";
import Image from "next/image";
import { siteConfig } from "~/lib/site-config";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Image
        src="/tracey-wordmark.png"
        alt={siteConfig.name}
        width={1323}
        height={605}
        priority
        className="h-12 w-auto"
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">You're offline</h1>
        <p className="text-sm text-[color:var(--muted-foreground)]">
          Reconnect to continue your training. Your progress is saved on the
          server.
        </p>
      </div>
      <Link
        href="/app"
        className="inline-flex h-9 items-center rounded-md bg-[color:var(--primary)] px-4 text-sm font-medium text-[color:var(--primary-foreground)] shadow hover:opacity-90"
      >
        Try again
      </Link>
    </main>
  );
}
