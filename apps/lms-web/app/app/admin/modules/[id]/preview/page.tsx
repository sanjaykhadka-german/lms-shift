import Link from "next/link";
import { BackLink } from "~/components/ui/back-link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  lmsContentItemMedia,
  lmsContentItems,
  lmsModuleMedia,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Button } from "~/components/ui/button";
import { ContentRenderer, Media } from "../../../../my/_components/ContentRenderer";
import { selfAssignAndTakeQuizAction } from "./actions";

export const metadata = { title: "Preview module" };

export default async function ModulePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    back?: string;
    score?: string;
    correct?: string;
    total?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();
  const fromAiStudio = sp.back === "ai-studio";

  // Author-preview score banner: populated when an admin submits the quiz
  // via "Take quiz as me" — values are URL params, not persisted.
  const previewScore = parseClampedInt(sp.score, 0, 100);
  const previewCorrect = parseClampedInt(sp.correct, 0, 9999);
  const previewTotal = parseClampedInt(sp.total, 0, 9999);
  const showPreviewBanner =
    previewScore !== null && previewCorrect !== null && previewTotal !== null;

  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;

  const [module] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1),
  );
  if (!module) notFound();

  const [contentItems, mediaItems, questions] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsContentItems)
        .where(and(eq(lmsContentItems.moduleId, moduleId), tenantWhere(lmsContentItems, tid)))
        .orderBy(asc(lmsContentItems.position)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsModuleMedia)
        .where(and(eq(lmsModuleMedia.moduleId, moduleId), tenantWhere(lmsModuleMedia, tid)))
        .orderBy(asc(lmsModuleMedia.position)),
    ),
    ctx.db.run((tx) =>
      tx
        .select()
        .from(lmsQuestions)
        .where(and(eq(lmsQuestions.moduleId, moduleId), tenantWhere(lmsQuestions, tid)))
        .orderBy(asc(lmsQuestions.position)),
    ),
  ]);

  const ciIds = contentItems.map((c) => c.id);
  const ciMedia = ciIds.length
    ? await ctx.db.run((tx) =>
        tx
          .select()
          .from(lmsContentItemMedia)
          .where(
            and(
              inArray(lmsContentItemMedia.contentItemId, ciIds),
              tenantWhere(lmsContentItemMedia, tid),
            ),
          )
          .orderBy(asc(lmsContentItemMedia.position)),
      )
    : [];
  const ciMediaByItem = new Map<number, typeof ciMedia>();
  for (const m of ciMedia) {
    const arr = ciMediaByItem.get(m.contentItemId) ?? [];
    arr.push(m);
    ciMediaByItem.set(m.contentItemId, arr);
  }

  const renderItems = contentItems.map((ci) => ({
    id: ci.id,
    kind: ci.kind,
    title: ci.title,
    body: ci.body ?? "",
    filePath: ci.filePath ?? "",
    position: ci.position ?? 0,
    mediaItems: (ciMediaByItem.get(ci.id) ?? []).map((m) => ({
      id: m.id,
      kind: m.kind ?? "",
      filePath: m.filePath,
    })),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <BackLink
          href={
            fromAiStudio
              ? `/app/admin/modules/ai-studio?module_id=${module.id}`
              : `/app/admin/modules/${module.id}`
          }
        >
          {fromAiStudio ? "Back to AI Studio" : "Back to edit"}
        </BackLink>
        <span className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Preview — exactly what employees see
        </span>
      </div>

      {showPreviewBanner && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)]/30 px-3 py-2 text-sm">
          <strong>Author preview:</strong> scored {previewScore}% (
          {previewCorrect}/{previewTotal}) — not saved.
        </div>
      )}

      <header>
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Training module
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{module.title}</h1>
        {module.description && (
          <p className="mt-2 whitespace-pre-line text-[color:var(--muted-foreground)]">
            {module.description}
          </p>
        )}
      </header>

      {module.coverPath && <Media filePath={module.coverPath} />}

      {mediaItems.length > 0 && (
        <div className="space-y-3">
          {mediaItems.map((m) => (
            <Media key={m.id} filePath={m.filePath} />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
        <ContentRenderer items={renderItems} />
      </div>

      {questions.length > 0 && (
        <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--secondary)] p-4 text-sm">
          The quiz on this module has {questions.length} question{questions.length === 1 ? "" : "s"}.
          Run it in this preview by clicking <strong>Take quiz</strong> below — your attempt will be
          saved (no preview-only mode in slice 4).
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link
            href={
              fromAiStudio
                ? `/app/admin/modules/ai-studio?module_id=${module.id}`
                : `/app/admin/modules/${module.id}`
            }
          >
            {fromAiStudio ? "Back to AI Studio" : "Back to edit"}
          </Link>
        </Button>
        {questions.length > 0 && (
          <form action={selfAssignAndTakeQuizAction}>
            <input type="hidden" name="module_id" value={module.id} />
            <Button type="submit">Take quiz as me</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function parseClampedInt(
  raw: string | undefined,
  min: number,
  max: number,
): number | null {
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}
