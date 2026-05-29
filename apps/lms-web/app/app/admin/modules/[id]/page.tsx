import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "~/components/ui/back-link";
import { HelpPopover } from "~/components/ui/help-popover";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  lmsAssignments,
  lmsChoices,
  lmsContentItemMedia,
  lmsContentItems,
  lmsModuleMedia,
  lmsModuleVersions,
  lmsModules,
  lmsQuestions,
  lmsUsers,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { formatDateTime } from "~/lib/format/datetime";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { mediaKindFromPath } from "~/lib/lms/scoring";
import {
  addModuleMediaAction,
  clearModuleCoverAction,
  removeModuleMediaAction,
  saveModuleVersionAction,
  setModuleCoverAction,
  updateModuleAction,
} from "./actions";
import {
  addContentItemAction,
  addContentMediaAction,
  deleteContentItemAction,
  removeContentMediaAction,
} from "./content/actions";
import { SectionForm } from "./_section-form";
import {
  addChoiceAction,
  addQuestionAction,
  deleteChoiceAction,
  deleteQuestionAction,
  updateChoiceAction,
  updateQuestionAction,
} from "./quiz/actions";

export const metadata = { title: "Edit module" };

const CONTENT_KINDS = [
  "section",
  "story",
  "scenario",
  "takeaway",
  "text",
  "link",
  "pdf",
  "doc",
  "audio",
  "video",
  "image",
] as const;

export default async function ModuleEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    msg?: string;
    v?: string;
    back?: string;
  }>;
}) {
  const { id } = await params;
  const moduleId = parseInt(id, 10);
  if (!Number.isFinite(moduleId)) notFound();
  const sp = await searchParams;
  const fromAiStudio = sp.back === "ai-studio";

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

  const [contentItems, moduleMedia, questions, versions, assignmentRows] = await Promise.all([
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
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsModuleVersions.id,
          versionNumber: lmsModuleVersions.versionNumber,
          summary: lmsModuleVersions.summary,
          createdAt: lmsModuleVersions.createdAt,
        })
        .from(lmsModuleVersions)
        .where(and(eq(lmsModuleVersions.moduleId, moduleId), tenantWhere(lmsModuleVersions, tid)))
        .orderBy(desc(lmsModuleVersions.versionNumber))
        .limit(10),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ count: lmsAssignments.id })
        .from(lmsAssignments)
        .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
        .where(
          and(
            eq(lmsAssignments.moduleId, moduleId),
            tenantWhere(lmsAssignments, tid),
          ),
        ),
    ),
  ]);

  const ciIds = contentItems.map((c) => c.id);
  const ciMedia = ciIds.length
    ? await ctx.db.run((tx) =>
        tx
          .select()
          .from(lmsContentItemMedia)
          .where(tenantWhere(lmsContentItemMedia, tid))
          .orderBy(asc(lmsContentItemMedia.position)),
      )
    : [];
  const ciMediaByItem = new Map<number, typeof ciMedia>();
  for (const m of ciMedia) {
    const arr = ciMediaByItem.get(m.contentItemId) ?? [];
    arr.push(m);
    ciMediaByItem.set(m.contentItemId, arr);
  }

  const qIds = questions.map((q) => q.id);
  const choices = qIds.length
    ? await ctx.db.run((tx) =>
        tx
          .select()
          .from(lmsChoices)
          .where(tenantWhere(lmsChoices, tid))
          .orderBy(asc(lmsChoices.position)),
      )
    : [];
  const choicesByQ = new Map<number, typeof choices>();
  for (const c of choices) {
    const arr = choicesByQ.get(c.questionId) ?? [];
    arr.push(c);
    choicesByQ.set(c.questionId, arr);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <BackLink
          href={
            fromAiStudio
              ? `/app/admin/modules/ai-studio?module_id=${moduleId}`
              : "/app/admin/modules"
          }
        >
          {fromAiStudio ? "Back to AI Studio" : "Back to modules"}
        </BackLink>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" tooltip="Preview this module as a learner would see it">
            <Link
              href={
                fromAiStudio
                  ? `/app/admin/modules/${moduleId}/preview?back=ai-studio`
                  : `/app/admin/modules/${moduleId}/preview`
              }
            >
              Preview
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" tooltip="Choose staff to assign this module to">
            <Link href={`/app/admin/modules/${moduleId}/assign`}>
              Assign ({assignmentRows.length})
            </Link>
          </Button>
        </div>
      </div>

      {sp.saved === "1" && <Banner kind="ok">Module saved.</Banner>}
      {sp.saved === "cover" && <Banner kind="ok">Cover updated.</Banner>}
      {sp.saved === "version" && <Banner kind="ok">Version v{sp.v} saved.</Banner>}
      {sp.error === "cover" && <Banner kind="err">Cover error: {sp.msg}</Banner>}
      {sp.error === "media" && <Banner kind="err">Media error: {sp.msg}</Banner>}
      {sp.error === "content_upload" && (
        <Banner kind="err">Content upload error: {sp.msg}</Banner>
      )}

      {/* Basic fields */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-lg">
            Module
            <HelpPopover label="About editing a module">
              Edit the module&apos;s title, description, and expiry window
              here. <strong>Valid for (days)</strong> controls how long a
              passed attempt counts as current — leave blank for no expiry.
              Set <strong>Status</strong> to <em>Published</em> once content
              and the quiz are ready; only published modules can be assigned.
              Use <strong>Preview</strong> to see what a learner sees, and
              <strong>Save version</strong> to pin a snapshot before making
              big changes (existing assignments keep the pinned version).
            </HelpPopover>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateModuleAction} className="space-y-4">
            <input type="hidden" name="id" value={module.id} />
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={module.title} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                defaultValue={module.description ?? ""}
                rows={8}
                className="w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="valid_for_days">Valid for (days)</Label>
                <Input
                  id="valid_for_days"
                  name="valid_for_days"
                  type="number"
                  min={0}
                  placeholder="180"
                  defaultValue={module.validForDays ?? ""}
                />
                <p className="text-xs text-[color:var(--muted-foreground)]">
                  How long a passed attempt counts as current. Blank = never expires.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="is_published">Status</Label>
                <select
                  id="is_published"
                  name="is_published"
                  defaultValue={module.isPublished ? "1" : "0"}
                  className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]"
                >
                  <option value="0">Draft</option>
                  <option value="1">Published</option>
                </select>
              </div>
            </div>
            <Button type="submit">Save module</Button>
          </form>
        </CardContent>
      </Card>

      {/* Cover */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {module.coverPath ? (
            <MediaPreview filePath={module.coverPath} className="max-h-64 max-w-full rounded-md" />
          ) : (
            <p className="text-sm text-[color:var(--muted-foreground)]">No cover set.</p>
          )}
          <form action={setModuleCoverAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={module.id} />
            <input
              type="file"
              name="cover"
              required
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf"
            />
            <Button type="submit" size="sm" tooltip="Upload an image or video as this module's cover">Upload cover</Button>
          </form>
          {module.coverPath && (
            <form action={clearModuleCoverAction}>
              <input type="hidden" name="id" value={module.id} />
              <Button type="submit" variant="outline" size="sm" tooltip="Remove the current cover image">Remove cover</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Module-level media */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Title-area media ({moduleMedia.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {moduleMedia.map((m) => (
              <div key={m.id} className="rounded-md border border-[color:var(--border)] p-2">
                <MediaPreview filePath={m.filePath} className="max-h-40 w-full rounded" />
                <form action={removeModuleMediaAction} className="mt-2">
                  <input type="hidden" name="module_id" value={module.id} />
                  <input type="hidden" name="id" value={m.id} />
                  <Button type="submit" variant="outline" size="sm" tooltip="Remove this title-area media item">Remove</Button>
                </form>
              </div>
            ))}
          </div>
          <form
            action={addModuleMediaAction}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="id" value={module.id} />
            <input type="file" name="media" required accept="image/*,video/*" />
            <Button type="submit" size="sm" tooltip="Upload another image or video to show under the module title">Add media</Button>
          </form>
        </CardContent>
      </Card>

      {/* Content sections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Content sections ({contentItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addContentItemAction} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-[color:var(--border)] p-3">
            <input type="hidden" name="module_id" value={module.id} />
            <div className="space-y-1">
              <Label htmlFor="new-content-kind">Kind</Label>
              <select
                id="new-content-kind"
                name="kind"
                defaultValue="section"
                className="flex h-9 w-full rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
              >
                {CONTENT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-content-title">Title</Label>
              <Input id="new-content-title" name="title" placeholder="New section" />
            </div>
            <Button type="submit" size="sm" tooltip="Add a new content section to this module">Add section</Button>
          </form>

          {contentItems.map((ci, idx) => (
            <ContentItemEditor
              key={ci.id}
              moduleId={module.id}
              item={ci}
              media={ciMediaByItem.get(ci.id) ?? []}
              index={idx}
            />
          ))}
        </CardContent>
      </Card>

      {/* Quiz */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quiz ({questions.length} question{questions.length === 1 ? "" : "s"})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={addQuestionAction} className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-[color:var(--border)] p-3">
            <input type="hidden" name="module_id" value={module.id} />
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-q-prompt">New question</Label>
              <Input id="new-q-prompt" name="prompt" placeholder="What is...?" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-q-kind">Type</Label>
              <select
                id="new-q-kind"
                name="kind"
                defaultValue="single"
                className="flex h-9 rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
              >
                <option value="single">Single answer</option>
                <option value="multi">Multi answer</option>
              </select>
            </div>
            <Button type="submit" size="sm" tooltip="Add a new quiz question">Add question</Button>
          </form>

          {questions.map((q) => (
            <QuestionEditor
              key={q.id}
              moduleId={module.id}
              question={q}
              choices={choicesByQ.get(q.id) ?? []}
            />
          ))}
        </CardContent>
      </Card>

      {/* Versions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Versions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form action={saveModuleVersionAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={module.id} />
            <div className="flex-1 space-y-1">
              <Label htmlFor="version-summary">Summary (optional)</Label>
              <Input id="version-summary" name="summary" placeholder="What changed in this snapshot?" />
            </div>
            <Button type="submit" size="sm" tooltip="Pin a snapshot of the current content and quiz">Save version</Button>
          </form>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            Saving a version pins a snapshot of the current content + questions.
            Existing assignments keep their version; new assignments get the latest.
          </p>
          {versions.length === 0 ? (
            <p className="rounded-md border border-dashed border-[color:var(--border)] px-3 py-4 text-center text-xs text-[color:var(--muted-foreground)]">
              No versions saved yet. Click <strong>Save version</strong> to pin a snapshot, or use AI Studio &mdash; an imported / applied module is auto-snapshotted.
            </p>
          ) : (
            <ul className="divide-y divide-[color:var(--border)] text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex justify-between py-2">
                  <span>
                    <strong>v{v.versionNumber}</strong>
                    {v.summary && <span className="text-[color:var(--muted-foreground)]"> — {v.summary}</span>}
                  </span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatDateTime(v.createdAt, ctx.tenantTimezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
        <span>Module id: {module.id}</span>
        <span>{module.isPublished ? <Badge variant="success">Published</Badge> : <Badge variant="secondary">Draft</Badge>}</span>
      </div>
    </div>
  );
}

function ContentItemEditor({
  moduleId,
  item,
  media,
  index,
}: {
  moduleId: number;
  item: typeof lmsContentItems.$inferSelect;
  media: Array<typeof lmsContentItemMedia.$inferSelect>;
  index: number;
}) {
  return (
    <div
      id={`content-${item.id}`}
      className="rounded-md border border-[color:var(--border)] p-3 space-y-3"
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
        <span>Section #{index + 1}</span>
        <form action={deleteContentItemAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="module_id" value={moduleId} />
          <Button type="submit" variant="outline" size="sm" tooltip="Delete this content section">Delete</Button>
        </form>
      </div>
      <SectionForm
        itemId={item.id}
        moduleId={moduleId}
        initialKind={item.kind}
        initialTitle={item.title}
        initialBody={item.body ?? ""}
        filePath={item.filePath ?? null}
      />

      {/* Per-section media */}
      <div className="rounded-md bg-[color:var(--secondary)] p-3 space-y-2">
        <div className="text-xs uppercase tracking-wider text-[color:var(--muted-foreground)]">
          Extra media ({media.length})
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {media.map((m) => (
            <div key={m.id} className="rounded-md border border-[color:var(--border)] bg-[color:var(--background)] p-2">
              <MediaPreview filePath={m.filePath} className="max-h-32 w-full rounded" />
              <form action={removeContentMediaAction} className="mt-2">
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="module_id" value={moduleId} />
                <Button type="submit" variant="outline" size="sm" tooltip="Remove this media item from the section">Remove</Button>
              </form>
            </div>
          ))}
        </div>
        <form action={addContentMediaAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="content_item_id" value={item.id} />
          <input type="hidden" name="module_id" value={moduleId} />
          <input type="file" name="media" required accept="image/*,video/*" />
          <Button type="submit" size="sm" tooltip="Upload an image or video to this section">Add</Button>
        </form>
      </div>
    </div>
  );
}

function QuestionEditor({
  moduleId,
  question,
  choices,
}: {
  moduleId: number;
  question: typeof lmsQuestions.$inferSelect;
  choices: Array<typeof lmsChoices.$inferSelect>;
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] p-3 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <form action={updateQuestionAction} className="flex flex-1 flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={question.id} />
          <input type="hidden" name="module_id" value={moduleId} />
          <div className="flex-1 space-y-1">
            <Label htmlFor={`q-${question.id}-prompt`}>Question</Label>
            <Input
              id={`q-${question.id}-prompt`}
              name="prompt"
              defaultValue={question.prompt}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`q-${question.id}-kind`}>Type</Label>
            <select
              id={`q-${question.id}-kind`}
              name="kind"
              defaultValue={question.kind ?? "single"}
              className="flex h-9 rounded-md border border-[color:var(--input)] bg-transparent px-3 text-sm shadow-sm"
            >
              <option value="single">Single</option>
              <option value="multi">Multi</option>
            </select>
          </div>
          <Button type="submit" size="sm" tooltip="Save changes to this question">Save</Button>
        </form>
        <form action={deleteQuestionAction}>
          <input type="hidden" name="id" value={question.id} />
          <input type="hidden" name="module_id" value={moduleId} />
          <Button type="submit" variant="outline" size="sm" tooltip="Delete this question and its answer choices">Delete</Button>
        </form>
      </div>

      {/* Choices */}
      <ul className="space-y-2">
        {choices.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-[color:var(--border)] p-2">
            <form action={updateChoiceAction} className="flex flex-1 flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="module_id" value={moduleId} />
              <Input name="text" defaultValue={c.text} className="flex-1 min-w-0" required />
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  name="is_correct"
                  value="1"
                  defaultChecked={c.isCorrect ?? false}
                />
                Correct
              </label>
              <Button type="submit" size="sm" tooltip="Save this answer choice">Save</Button>
            </form>
            <form action={deleteChoiceAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="module_id" value={moduleId} />
              <Button type="submit" variant="outline" size="sm" tooltip="Delete this answer choice">×</Button>
            </form>
          </li>
        ))}
      </ul>

      {/* Add choice */}
      <form action={addChoiceAction} className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[color:var(--border)] p-2">
        <input type="hidden" name="question_id" value={question.id} />
        <input type="hidden" name="module_id" value={moduleId} />
        <Input name="text" placeholder="New choice…" className="flex-1 min-w-0" required />
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="is_correct" value="1" />
          Correct
        </label>
        <Button type="submit" size="sm" tooltip="Add this answer choice to the question">Add</Button>
      </form>
    </div>
  );
}

function MediaPreview({ filePath, className }: { filePath: string; className?: string }) {
  const kind = mediaKindFromPath(filePath);
  const url = `/uploads/${encodeURIComponent(filePath)}`;
  if (kind === "image") return <img src={url} alt="" className={className} />;
  if (kind === "video") {
    return (
      <video controls className={className}>
        <source src={url} />
      </video>
    );
  }
  if (kind === "audio") {
    return (
      <audio controls className="w-full">
        <source src={url} />
      </audio>
    );
  }
  if (kind === "pdf" || kind === "doc") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm underline">
        Open {filePath}
      </a>
    );
  }
  return <span className="text-xs text-[color:var(--muted-foreground)]">{filePath}</span>;
}

function Banner({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  const cls =
    kind === "ok"
      ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10"
      : "border-[color:var(--destructive)] bg-[color:var(--destructive)]/5 text-[color:var(--destructive)]";
  return <div className={`rounded-md border ${cls} px-4 py-2 text-sm`}>{children}</div>;
}
