import Link from "next/link";
import {
  getAttemptAggregates,
  listAssignmentsForUser,
  listRecentAttempts,
  requireLearner,
  type AssignmentRow,
} from "~/lib/lms/learner";
import { formatDate, formatDateTime } from "~/lib/format/datetime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/page-header";
import { StatCard } from "../_components/StatCard";
import { ModuleCard, type ModuleStatus } from "../_components/ModuleCard";

export const metadata = { title: "My training" };

export default async function MyModulesPage() {
  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const [rows, recent, agg] = await Promise.all([
    listAssignmentsForUser(lmsUser.id, traceyTenantId),
    listRecentAttempts(lmsUser.id, traceyTenantId, 5),
    getAttemptAggregates(lmsUser.id, traceyTenantId),
  ]);

  const now = Date.now();
  const soonMs = 7 * 24 * 60 * 60 * 1000;

  const decorated = rows.map((r) => ({ ...r, status: classify(r, now, soonMs) }));
  const completed = decorated.filter((r) => r.status === "completed").length;
  const outstanding = decorated.length - completed;
  const overdue = decorated.filter((r) => r.status === "overdue").length;
  const dueSoon = decorated.filter((r) => r.status === "due_soon").length;

  const total = decorated.length;
  const totalAttempts = agg.total;
  const avgScore = agg.avgScore;
  const passRate = agg.passRate;
  const completionRate = total === 0 ? 0 : Math.round((completed * 1000) / total) / 10;

  const nextUp = decorated.find((r) => r.status !== "completed");

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 px-4 py-10">
      <PageHeader
        title="My training"
        description="Track your progress, pick up where you left off, and review past results."
        badge={
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            01 / Your training
          </span>
        }
      />

      {total === 0 ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-8 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Nothing yet
          </div>
          <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
            No training assigned yet. Check back soon.
          </p>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Completion"
              value={`${completionRate}%`}
              progressPercent={completionRate}
            />
            <StatCard
              label="Completed"
              value={
                <>
                  {completed}
                  <span className="text-base text-[color:var(--muted-foreground)]"> / {total}</span>
                </>
              }
            />
            <StatCard
              label="Outstanding"
              value={
                <span className="inline-flex items-center gap-2">
                  {outstanding}
                  {overdue > 0 && <Badge variant="destructive">{overdue} overdue</Badge>}
                  {overdue === 0 && dueSoon > 0 && <Badge variant="warning">{dueSoon} due soon</Badge>}
                </span>
              }
            />
            <StatCard
              label="Avg score"
              value={totalAttempts ? `${avgScore}%` : "—"}
              hint={
                totalAttempts ? (
                  <>
                    {passRate}% pass · {totalAttempts} attempt{totalAttempts === 1 ? "" : "s"}
                  </>
                ) : null
              }
            />
          </section>

          {nextUp && <NextUpCard row={nextUp} timezone={tenantTimezone} />}

          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
              All assigned modules
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {decorated.map((r) => (
                <ModuleCard
                  key={r.assignment.id}
                  moduleId={r.module.id}
                  title={r.module.title}
                  description={r.module.description}
                  status={r.status}
                  attempts={r.attempts}
                  bestScore={r.bestScore}
                  lastAttemptAt={r.lastAttemptAt}
                  dueAt={r.assignment.dueAt}
                  timezone={tenantTimezone}
                />
              ))}
            </div>
          </section>

          {recent.length > 0 && (
            <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold">Recent attempts</h2>
                <span className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                  Your last {recent.length}
                </span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
                    <tr>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Module</th>
                      <th className="py-2 pr-3 text-right">Score</th>
                      <th className="py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border)]">
                    {recent.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 pr-3 align-middle">
                          {formatDateTime(a.createdAt, tenantTimezone, {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-3 align-middle">{a.moduleTitle ?? a.moduleId}</td>
                        <td className="py-2 pr-3 align-middle text-right font-semibold">{a.score}%</td>
                        <td className="py-2 align-middle">
                          {a.passed ? (
                            <Badge variant="success">Passed</Badge>
                          ) : (
                            <Badge variant="destructive">Failed</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function NextUpCard({
  row,
  timezone,
}: {
  row: AssignmentRow & { status: ModuleStatus };
  timezone: string;
}) {
  return (
    <div className="rounded-xl border-2 border-[color:var(--foreground)] bg-[color:var(--card)] p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Continue where you left off
          </div>
          <h3 className="mt-1 text-xl font-semibold tracking-tight">{row.module.title}</h3>
          <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
            {row.attempts > 0 ? (
              <>
                Best score so far: <strong className="text-[color:var(--foreground)]">{row.bestScore ?? 0}%</strong>
                {" · "}
                {row.attempts} attempt{row.attempts === 1 ? "" : "s"}
              </>
            ) : (
              <>Not started yet.</>
            )}
            {row.assignment.dueAt && (
              <>
                {" · Due "}
                {formatDate(row.assignment.dueAt, timezone, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {row.status === "overdue" && (
                  <Badge className="ml-2" variant="destructive">
                    Overdue
                  </Badge>
                )}
                {row.status === "due_soon" && (
                  <Badge className="ml-2" variant="warning">
                    Due soon
                  </Badge>
                )}
              </>
            )}
          </div>
        </div>
        <Button
          asChild
          tooltip={
            row.attempts > 0
              ? "Continue where you left off"
              : "Begin this training module"
          }
        >
          <Link href={`/app/my/modules/${row.module.id}`}>
            {row.attempts > 0 ? "Resume" : "Start"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function classify(
  r: AssignmentRow,
  now: number,
  soonMs: number,
): ModuleStatus {
  if (r.assignment.completedAt) return "completed";
  if (r.assignment.dueAt) {
    const t = r.assignment.dueAt.getTime();
    if (t < now) return "overdue";
    if (t < now + soonMs) return "due_soon";
  }
  return "open";
}
