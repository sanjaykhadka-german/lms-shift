import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { Button } from "~/components/ui/button";
import {
  getAssignmentForLearner,
  getModuleForAssignment,
  requireLearner,
} from "~/lib/lms/learner";
import { ContentRenderer, Media } from "../../_components/ContentRenderer";

export const metadata = { title: "Training module" };

export default async function MyModulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();

  const { lmsUser, traceyTenantId } = await requireLearner();
  const row = await getAssignmentForLearner(lmsUser.id, moduleId, traceyTenantId);
  if (!row) notFound();

  const mod = await getModuleForAssignment({
    assignment: row.assignment,
    liveModule: row.module,
  });
  const hasQuiz = mod.questions.length > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <BackLink href="/app/my/modules">Back to my training</BackLink>

      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Training module
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{mod.title}</h1>
        {mod.description && (
          <p className="mt-2 whitespace-pre-line text-[color:var(--muted-foreground)]">
            {mod.description}
          </p>
        )}
      </header>

      {mod.coverPath && (
        <div>
          <Media filePath={mod.coverPath} />
        </div>
      )}

      {mod.mediaItems.length > 0 && (
        <div className="space-y-3">
          {mod.mediaItems.map((m) => (
            <Media key={m.id} filePath={m.filePath} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
        <ContentRenderer items={mod.contentItems} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink href="/app/my/modules">Back to my training</BackLink>
        {hasQuiz ? (
          <Button asChild size="lg">
            <Link href={`/app/my/modules/${mod.id}/quiz`}>Take the quiz</Link>
          </Button>
        ) : (
          <span className="text-sm italic text-[color:var(--muted-foreground)]">
            This module has no quiz yet.
          </span>
        )}
      </div>
    </div>
  );
}
