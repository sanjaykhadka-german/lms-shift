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
import { initials } from "~/lib/utils";

const features = [
  {
    icon: Clock,
    title: "Time clock",
    body: "Clock in and out with location + break tracking. Live status for managers.",
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
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
          <Link href="/" className="flex items-center" aria-label="ShiftCraft">
            <Logo />
          </Link>
          <nav className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/20">
              For hospitality teams
            </span>
            <h1
              className="mt-5 text-5xl leading-[1.05] tracking-tight md:text-6xl"
              style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
            >
              Rosters that move at the
              <span className="italic text-primary"> speed</span> of your floor.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
              ShiftCraft brings time-tracking, rostering, timesheets, leave, and tasks into
              one workforce studio — built for shops, cafés, and production floors that
              need to move fast.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="inline-flex items-center rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:opacity-90"
              >
                Start a workspace
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center rounded-md border border-border px-6 py-3 text-base font-medium hover:bg-muted"
              >
                Sign in
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
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

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  On the floor now
                </div>
                <div
                  className="text-2xl"
                  style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
                >
                  14 of 18 staff
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                Live
              </span>
            </div>
            <div className="space-y-3">
              {onFloor.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {initials(s.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.role} · since {s.start}
                    </div>
                  </div>
                  <div className="text-sm font-semibold tabular-nums">{s.dur}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border" />
            <div className="mt-4 grid grid-cols-3 text-center">
              <div>
                <div
                  className="text-xl"
                  style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
                >
                  142h
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Week to date
                </div>
              </div>
              <div>
                <div
                  className="text-xl text-primary"
                  style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
                >
                  3
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Open shifts
                </div>
              </div>
              <div>
                <div
                  className="text-xl"
                  style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
                >
                  2
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Pending leave
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Everything your floor needs
          </div>
          <h2
            className="mt-2 text-3xl md:text-4xl"
            style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
          >
            A workforce studio, not just a punch clock.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border bg-card p-6 shadow-sm">
                <Icon className="h-5 w-5 text-primary" />
                <div
                  className="mt-4 text-xl"
                  style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
                >
                  {title}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          01 / Try it
        </div>
        <h2
          className="mt-3 text-4xl"
          style={{ fontFamily: "var(--font-heading), ui-serif, Georgia, serif" }}
        >
          Spin up your workspace in under a minute.
        </h2>
        <p className="mt-4 text-muted-foreground">
          Or sign in with your existing Tracey account — ShiftCraft shares accounts and
          tenants with the LMS.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/sign-up"
            className="inline-flex items-center rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:opacity-90"
          >
            Create account
          </Link>
          <Link
            href="/sign-in"
            className="inline-flex items-center rounded-md border border-border px-6 py-3 text-base font-medium hover:bg-muted"
          >
            Sign in
          </Link>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ShiftCraft · part of Tracey</span>
          <nav className="flex items-center gap-4">
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
