import Link from "next/link";
import { Button } from "~/components/ui/button";
import { siteConfig } from "~/lib/site-config";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[color:var(--background)] via-[color:var(--background)] to-[color:var(--accent)]/5"
      />
      <div className="relative mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          {siteConfig.tagline}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-[color:var(--muted-foreground)]">
          Tracey turns your policies, procedures, and training materials into quizzes,
          qualifications, and audit trails. Built for teams who want their
          people trained — not their LMS managed.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">Start {siteConfig.trialDays}-day free trial</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#pricing">See pricing</Link>
          </Button>
        </div>
        <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
          No credit card required.
        </p>
      </div>
    </section>
  );
}
