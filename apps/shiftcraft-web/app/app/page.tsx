import Link from "next/link";
import { currentMembership, currentUser } from "~/lib/auth/current";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) return null;
  const membership = await currentMembership();

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Welcome back{user.name ? `, ${user.name.split(" ")[0]}` : ""}.
      </h1>
      <p className="mt-2 text-muted-foreground">
        {membership
          ? `You're signed in to ${membership.tenant.name} as ${membership.role}.`
          : "You're signed in. Set up a workspace from the LMS to start using ShiftCraft features."}
      </p>

      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Live
          title="Locations"
          body="Physical sites where shifts happen."
          href="/app/locations"
        />
        <Stub title="Schedule" body="Weekly grid, shift CRUD, swaps." />
        <Stub title="Time clock" body="Clock in/out + breaks, live status." />
        <Stub title="Timesheets" body="Auto-built from clock activity, weekly approval." />
      </div>

      <p className="mt-8 text-xs text-muted-foreground">
        Locations is live. Scheduling and time tracking arrive in subsequent phases.
      </p>
    </div>
  );
}

function Stub({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg border bg-card p-5 shadow-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <p className="mt-3 text-xs text-muted-foreground">Coming soon.</p>
    </article>
  );
}

function Live({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <p className="mt-3 text-xs font-medium text-primary">Open →</p>
    </Link>
  );
}
