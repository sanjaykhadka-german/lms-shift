import Link from "next/link";
import { listRecentAttempts, requireLearner } from "~/lib/lms/learner";
import { formatDateTime } from "~/lib/format/datetime";
import { PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export const metadata = { title: "My results" };

export default async function MyResultsPage() {
  const { lmsUser, traceyTenantId, tenantTimezone } = await requireLearner();
  const attempts = await listRecentAttempts(lmsUser.id, traceyTenantId, 200);

  return (
    <div className="mx-auto max-w-[1800px] space-y-8 px-4 py-10">
      <PageHeader
        title="My results"
        description="Every quiz attempt you've made, newest first."
        badge={
          <span className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
            Results history
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/app/my/modules">My training</Link>
          </Button>
        }
      />

      {attempts.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-8 text-center text-sm text-[color:var(--muted-foreground)]">
          You haven&apos;t taken any quizzes yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
              <tr className="border-b border-[color:var(--border)]">
                <th className="px-6 py-3">Date</th>
                <th className="px-3 py-3">Module</th>
                <th className="px-3 py-3 text-right">Score</th>
                <th className="px-3 py-3">Result</th>
                <th className="px-6 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {attempts.map((a) => (
                <tr key={a.id}>
                  <td className="px-6 py-3 align-middle text-[color:var(--muted-foreground)]">
                    {a.createdAt
                      ? formatDateTime(a.createdAt, tenantTimezone)
                      : "—"}
                  </td>
                  <td className="px-3 py-3 align-middle font-medium">
                    {a.moduleTitle ?? `Module ${a.moduleId}`}
                  </td>
                  <td className="px-3 py-3 align-middle text-right font-semibold">
                    {a.score}%
                  </td>
                  <td className="px-3 py-3 align-middle">
                    {a.passed ? (
                      <Badge variant="success">Passed</Badge>
                    ) : (
                      <Badge variant="destructive">Failed</Badge>
                    )}
                  </td>
                  <td className="px-6 py-3 align-middle text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/app/my/results/${a.id}`}>View</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
