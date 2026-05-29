import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clock,
  FileSpreadsheet,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Logo } from "~/components/Logo";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Badge } from "~/components/ui/badge";
import { initials } from "~/lib/utils";
import { Pricing } from "./_pricing";

const features = [
  {
    icon: Clock,
    title: "Time clock",
    body: "Clock in and out with location + break tracking. Live status for managers.",
    wide: true,
  },
  {
    icon: CalendarDays,
    title: "Schedule",
    body: "Plan weekly shifts across locations. Publish, swap, and fill open roles.",
  },
  {
    icon: FileSpreadsheet,
    title: "Timesheets",
    body: "Auto-generated from clock activity. Approve weekly with a single click.",
  },
  {
    icon: Users,
    title: "Team & roles",
    body: "Admin, manager, and employee permissions out of the box.",
  },
  {
    icon: ShieldCheck,
    title: "Leave & tasks",
    body: "Request leave, assign tasks, track urgency — all in one place.",
  },
  {
    icon: BarChart3,
    title: "Reports",
    body: "Hours, costs, and coverage reporting for every location.",
  },
];

const onFloor = [
  { name: "Lena Kowalski", role: "Senior Butcher", start: "06:00", dur: "7h 12m" },
  { name: "Hugo Müller", role: "Floor Manager", start: "07:30", dur: "5h 42m" },
  { name: "Priya Anand", role: "Counter Lead", start: "08:00", dur: "5h 12m" },
];

export default function MarketingHome() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-40 w-full border-b border-line bg-[color-mix(in_srgb,var(--bone)_80%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center" aria-label="ShiftCraft">
            <Logo size="sm" />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="#pricing"
              className="hidden text-sm font-medium text-ink-2 hover:text-ink sm:inline"
            >
              Pricing
            </Link>
            <Link href="/sign-in" className="text-sm font-medium text-ink-2 hover:text-ink">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-1.5 rounded-[var(--r-sm)] bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-ink)] shadow-[0_8px_18px_-10px_var(--accent-deep)] hover:brightness-[0.97]"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(var(--line-soft) 1px, transparent 1px), linear-gradient(90deg, var(--line-soft) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(110% 80% at 20% 0%, #000 30%, transparent 100%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center rounded-full border border-line bg-[var(--paper)] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">
                Built for every shift-based team
              </span>
              <h1 className="mt-5 font-display text-5xl font-bold leading-[1.04] tracking-[-0.03em] text-ink md:text-6xl">
                Rosters that move at the{" "}
                <span className="relative inline-block">
                  <span className="relative z-10">speed</span>
                  <span
                    aria-hidden
                    className="absolute inset-x-[-4px] bottom-1 z-0 h-3.5 -rotate-1 rounded-[3px] bg-[var(--accent)]"
                  />
                </span>{" "}
                of your team.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
                ShiftCraft brings time-tracking, rostering, timesheets, leave, and tasks into
                one workforce studio — built for any business that runs on shifts and needs
                to move fast.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center rounded-[var(--r-sm)] bg-[var(--accent)] px-6 py-3 text-base font-semibold text-[var(--accent-ink)] shadow-[0_8px_18px_-10px_var(--accent-deep)] hover:brightness-[0.97]"
                >
                  Start a workspace
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center rounded-[var(--r-sm)] border border-line px-6 py-3 text-base font-semibold text-ink hover:bg-paper-2"
                >
                  Sign in
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-6 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5" /> Multi-role access
                </span>
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" /> Live time clock
                </span>
                <span className="inline-flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" /> Multi-location
                </span>
              </div>
            </div>

            {/* Dark product-preview card */}
            <div className="relative rounded-[var(--r-lg)] border border-[rgba(244,238,227,0.13)] bg-[var(--ink)] p-6 text-[#f4eee3] shadow-[var(--shadow)]">
              <div className="mb-5 flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f4eee3]/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#f4eee3]/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#f4eee3]/20" />
              </div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#766b5e]">
                    On shift now
                  </div>
                  <div className="mt-0.5 font-display text-2xl font-semibold">14 of 18 staff</div>
                </div>
                <Badge variant="live" dot>
                  Live
                </Badge>
              </div>
              <div className="space-y-3">
                {onFloor.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-3 rounded-[var(--r-md)] border border-[rgba(244,238,227,0.1)] bg-[rgba(244,238,227,0.03)] px-3 py-2.5"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--accent)] font-display text-sm font-semibold text-[var(--accent-ink)]">
                      {initials(s.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{s.name}</div>
                      <div className="font-mono text-[11px] text-[#a89c8c]">
                        {s.role} · since {s.start}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums">{s.dur}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-[rgba(244,238,227,0.1)] pt-4 text-center">
                {[
                  { v: "142h", l: "Week to date", accent: false },
                  { v: "3", l: "Open shifts", accent: true },
                  { v: "2", l: "Pending leave", accent: false },
                ].map((stat) => (
                  <div key={stat.l}>
                    <div
                      className={`font-mono text-xl font-semibold ${stat.accent ? "text-[var(--accent)]" : ""}`}
                    >
                      {stat.v}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#766b5e]">
                      {stat.l}
                    </div>
                  </div>
                ))}
              </div>
              {/* Floating lime chip */}
              <div className="absolute -bottom-3 -right-3 rounded-full bg-[var(--accent)] px-3 py-1.5 font-mono text-[11px] font-semibold text-[var(--accent-ink)] shadow-[0_10px_24px_-12px_var(--accent-deep)]">
                08:42 · Clocked in
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-[var(--paper-2)]/50">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-3">
            Everything your team needs
          </div>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-[-0.02em] text-ink md:text-4xl">
            A workforce studio, not just a punch clock.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {features.map(({ icon: Icon, title, body, wide }) => {
              const dark = wide;
              return (
                <div
                  key={title}
                  className={`rounded-[var(--r-lg)] border p-6 shadow-[var(--shadow-sm)] ${
                    dark
                      ? "border-[rgba(244,238,227,0.13)] bg-[var(--ink)] text-[#f4eee3] md:col-span-2"
                      : "border-line bg-[var(--paper)]"
                  }`}
                >
                  <Icon className="h-5 w-5 text-[var(--accent)]" />
                  <div className="mt-4 font-display text-xl font-semibold">{title}</div>
                  <p
                    className={`mt-2 text-sm leading-relaxed ${dark ? "text-[#a89c8c]" : "text-ink-2"}`}
                  >
                    {body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <Pricing />

      {/* CTA dark card */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="relative overflow-hidden rounded-[var(--r-lg)] bg-[var(--ink)] px-8 py-16 text-center text-[#f4eee3] shadow-[var(--shadow)]">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#766b5e]">
            01 / Try it
          </div>
          <h2 className="mx-auto mt-3 max-w-2xl font-display text-4xl font-semibold tracking-[-0.02em]">
            Spin up your workspace in under a minute.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[#a89c8c]">
            Or sign in with your existing Tracey account — ShiftCraft shares accounts and
            tenants with the LMS.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center rounded-[var(--r-sm)] bg-[var(--accent)] px-6 py-3 text-base font-semibold text-[var(--accent-ink)] hover:brightness-[0.97]"
            >
              Create account
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center rounded-[var(--r-sm)] border border-[rgba(244,238,227,0.25)] px-6 py-3 text-base font-semibold text-[#f4eee3] hover:bg-[rgba(244,238,227,0.08)]"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 px-6 py-8 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ShiftCraft · part of Tracey</span>
          <nav className="flex items-center gap-4">
            <Link href="#pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/sign-in" className="hover:text-ink">
              Sign in
            </Link>
            <Link href="/sign-up" className="hover:text-ink">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
