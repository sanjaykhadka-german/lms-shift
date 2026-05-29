import Link from "next/link";
import { Logo } from "./Logo";
import { Badge } from "./ui/badge";
import { cn } from "~/lib/utils";

/**
 * Two-panel auth layout: an editorial "ink" aside (hidden on small screens)
 * and the form column. The aside copy is a marketing flourish only — the
 * "on shift" rows are illustrative, not live data.
 */
export function AuthShell({
  mode,
  returnTo,
  heading,
  subheading,
  children,
}: {
  mode: "signin" | "signup";
  returnTo?: string;
  heading: string;
  subheading: string;
  children: React.ReactNode;
}) {
  const signInHref = returnTo ? `/sign-in?returnTo=${encodeURIComponent(returnTo)}` : "/sign-in";
  const signUpHref = returnTo ? `/sign-up?returnTo=${encodeURIComponent(returnTo)}` : "/sign-up";

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Ink aside */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[var(--ink)] p-12 text-[#f4eee3] lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.6]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(244,238,227,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(244,238,227,.05) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(120% 90% at 30% 0%, #000 40%, transparent 100%)",
          }}
        />
        <div className="relative">
          <Logo size="md" tone="onDark" />
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-[2.6rem] font-bold leading-[1.05] tracking-[-0.03em]">
            Rosters that move at the{" "}
            <span className="text-[var(--accent)]">speed</span> of your team.
          </h2>
          <p className="mt-4 text-[15px] text-[#a89c8c]">
            Schedule, time-clock, timesheets and approvals — one warm, fast workspace for
            the whole floor.
          </p>
        </div>
        <div className="relative rounded-[var(--r-lg)] border border-[rgba(244,238,227,.13)] bg-[rgba(244,238,227,.04)] p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#766b5e]">
              On shift now
            </span>
            <Badge variant="live" dot>
              Live
            </Badge>
          </div>
          <div className="mt-4 space-y-3">
            {[
              { n: "Hugo Müller", r: "Floor manager", t: "since 06:00" },
              { n: "Lena Brandt", r: "Butcher", t: "since 07:30" },
            ].map((p) => (
              <div key={p.n} className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[var(--accent)] font-display text-xs font-semibold text-[var(--accent-ink)]">
                  {p.n
                    .split(" ")
                    .map((s) => s[0])
                    .join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{p.n}</div>
                  <div className="text-[12px] text-[#a89c8c]">{p.r}</div>
                </div>
                <div className="font-mono text-[11px] text-[#766b5e]">{p.t}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Form column */}
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm space-y-7">
          <div className="lg:hidden">
            <Logo size="md" />
          </div>

          {/* Sign in / Create toggle */}
          <div className="inline-flex gap-0.5 rounded-[var(--r-sm)] border border-line bg-[var(--paper-2)] p-0.5 text-[13px] font-semibold">
            <Link
              href={signInHref}
              className={cn(
                "rounded-[calc(var(--r-sm)-3px)] px-4 py-1.5 transition-colors",
                mode === "signin"
                  ? "bg-[var(--raise)] text-ink shadow-[var(--shadow-sm)]"
                  : "text-ink-2 hover:text-ink",
              )}
            >
              Sign in
            </Link>
            <Link
              href={signUpHref}
              className={cn(
                "rounded-[calc(var(--r-sm)-3px)] px-4 py-1.5 transition-colors",
                mode === "signup"
                  ? "bg-[var(--raise)] text-ink shadow-[var(--shadow-sm)]"
                  : "text-ink-2 hover:text-ink",
              )}
            >
              Create workspace
            </Link>
          </div>

          <div className="space-y-1.5">
            <h1 className="font-display text-[1.9rem] font-semibold tracking-[-0.02em] text-ink">
              {heading}
            </h1>
            <p className="text-sm text-ink-2">{subheading}</p>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
