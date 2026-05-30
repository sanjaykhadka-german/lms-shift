import Link from "next/link";
import {
  getAttemptAggregates,
  listAssignmentsForUser,
  requireLearner,
} from "~/lib/lms/learner";
import { listEarnedCertificates } from "~/lib/lms/certificates";
import { PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { StatCard } from "./_components/StatCard";

export const metadata = { title: "My dashboard" };

export default async function MyDashboardPage() {
  const { lmsUser, traceyTenantId } = await requireLearner();
  const [assignments, agg, certs] = await Promise.all([
    listAssignmentsForUser(lmsUser.id, traceyTenantId),
    getAttemptAggregates(lmsUser.id, traceyTenantId),
    listEarnedCertificates(lmsUser.id, traceyTenantId),
  ]);

  const now = Date.now();
  const total = assignments.length;
  const completed = assignments.filter((a) => a.assignment.completedAt).length;
  const outstanding = total - completed;
  const overdue = assignments.filter(
    (a) =>
      a.assignment.dueAt &&
      !a.assignment.completedAt &&
      new Date(a.assignment.dueAt).getTime() < now,
  ).length;
  const completionRate = total === 0 ? 0 : Math.round((completed * 1000) / total) / 10;
  const nextUp = assignments.find((a) => !a.assignment.completedAt);
  const firstName = (lmsUser.name ?? "").trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 px-4 py-10">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description="Your training at a glance."
        badge={
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Dashboard
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/app/my/results">Results</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/my/certificates">Certificates</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/app/my/transcript">Transcript</Link>
            </Button>
            <Button asChild>
              <Link href="/app/my/modules">My training</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Assigned"
          value={total}
          hint={`${outstanding} outstanding${overdue ? ` · ${overdue} overdue` : ""}`}
        />
        <StatCard
          label="Completed"
          value={completed}
          progressPercent={completionRate}
          hint={`${completionRate}% complete`}
        />
        <StatCard label="Pass rate" value={`${agg.passRate}%`} hint={`avg ${agg.avgScore}%`} />
        <StatCard label="Certificates" value={certs.length} hint="Earned" />
      </div>

      {nextUp ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
              Continue training
            </div>
            <div className="mt-1 text-lg font-semibold">{nextUp.module.title}</div>
          </div>
          <Button asChild>
            <Link href={`/app/my/modules/${nextUp.module.id}`}>Open module</Link>
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 text-sm text-[color:var(--muted-foreground)]">
          You&apos;re all caught up — no outstanding training. 🎉
        </div>
      )}
    </div>
  );
}
