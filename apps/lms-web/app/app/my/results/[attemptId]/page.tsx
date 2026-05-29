import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getAttemptForLearner, requireLearner } from "~/lib/lms/learner";
import { PASS_THRESHOLD } from "~/lib/site-config";
import { ReviewBlock } from "../../_components/ReviewBlock";

export const metadata = { title: "Quiz result" };

export default async function ResultPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  const id = parseInt(attemptId, 10);
  if (!Number.isFinite(id)) notFound();

  const { lmsUser, traceyTenantId } = await requireLearner();
  const data = await getAttemptForLearner(id, lmsUser.id, traceyTenantId);
  if (!data) notFound();
  const { attempt, module, review } = data;
  const passed = attempt.passed ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="text-center">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Result
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{module.title}</h1>
        <div className="mt-4 text-6xl font-bold tracking-tight">{attempt.score}%</div>
        <div className="mt-1 text-sm text-[color:var(--muted-foreground)]">
          {attempt.correct} of {attempt.total} correct — pass mark {PASS_THRESHOLD}%
        </div>
        <div className="mt-3 flex justify-center">
          {passed ? (
            <Badge variant="success">Passed</Badge>
          ) : (
            <Badge variant="destructive">Not passed — please review and retake</Badge>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/app/my/modules/${module.id}`}>Back to module</Link>
          </Button>
          <Button asChild>
            <Link href="/app/my/modules">My training</Link>
          </Button>
        </div>
      </div>

      <ReviewBlock review={review} />
    </div>
  );
}
