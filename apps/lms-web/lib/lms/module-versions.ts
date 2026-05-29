import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  lmsChoices,
  lmsContentItemMedia,
  lmsContentItems,
  lmsModuleMedia,
  lmsModuleVersions,
  lmsModules,
  lmsQuestions,
  type TenantDb,
} from "@tracey/db";
import { tenantWhere } from "./tenant-scope";

/**
 * Snapshot the current state of a module + content + quiz into a new
 * lms_module_versions row, auto-incrementing version_number per module.
 * Returns the new versionNumber.
 *
 * Shape mirrors saveModuleVersionAction so any downstream consumer
 * (rollback / diff tooling) sees a single canonical format whether the
 * snapshot was triggered by the operator's "Save version" button or by
 * an automated AI-Studio import / apply.
 */
export async function snapshotModuleVersion(opts: {
  tdb: TenantDb;
  moduleId: number;
  tenantId: string;
  createdById: number | null;
  summary: string;
}): Promise<number> {
  const { tdb, moduleId, tenantId, createdById, summary } = opts;

  const data = await tdb.run(async (tx) => {
    const [moduleRow, contentItems, mediaItems, questions] = await Promise.all([
      tx
        .select()
        .from(lmsModules)
        .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tenantId)))
        .limit(1),
      tx
        .select()
        .from(lmsContentItems)
        .where(
          and(
            eq(lmsContentItems.moduleId, moduleId),
            tenantWhere(lmsContentItems, tenantId),
          ),
        )
        .orderBy(lmsContentItems.position),
      tx
        .select()
        .from(lmsModuleMedia)
        .where(
          and(
            eq(lmsModuleMedia.moduleId, moduleId),
            tenantWhere(lmsModuleMedia, tenantId),
          ),
        )
        .orderBy(lmsModuleMedia.position),
      tx
        .select()
        .from(lmsQuestions)
        .where(
          and(
            eq(lmsQuestions.moduleId, moduleId),
            tenantWhere(lmsQuestions, tenantId),
          ),
        )
        .orderBy(lmsQuestions.position),
    ]);
    const m = moduleRow[0];
    if (!m) throw new Error(`snapshotModuleVersion: module ${moduleId} not found`);
    const ciIds = contentItems.map((c) => c.id);
    const ciMedia = ciIds.length
      ? await tx
          .select()
          .from(lmsContentItemMedia)
          .where(tenantWhere(lmsContentItemMedia, tenantId))
      : [];
    const qIds = questions.map((q) => q.id);
    const choices = qIds.length
      ? await tx
          .select()
          .from(lmsChoices)
          .where(tenantWhere(lmsChoices, tenantId))
      : [];
    return { m, contentItems, mediaItems, questions, ciMedia, choices };
  });

  const ciMediaByItem = new Map<number, typeof data.ciMedia>();
  for (const x of data.ciMedia) {
    const arr = ciMediaByItem.get(x.contentItemId) ?? [];
    arr.push(x);
    ciMediaByItem.set(x.contentItemId, arr);
  }
  const choicesByQ = new Map<number, typeof data.choices>();
  for (const c of data.choices) {
    const arr = choicesByQ.get(c.questionId) ?? [];
    arr.push(c);
    choicesByQ.set(c.questionId, arr);
  }

  const snapshot = {
    title: data.m.title,
    description: data.m.description ?? "",
    is_published: data.m.isPublished ?? true,
    cover_path: data.m.coverPath ?? "",
    media_items: data.mediaItems.map((x) => ({
      id: x.id,
      kind: x.kind,
      file_path: x.filePath,
    })),
    content_items: data.contentItems.map((ci) => ({
      id: ci.id,
      kind: ci.kind,
      title: ci.title,
      body: ci.body,
      file_path: ci.filePath,
      position: ci.position,
      media_items: (ciMediaByItem.get(ci.id) ?? []).map((x) => ({
        id: x.id,
        kind: x.kind,
        file_path: x.filePath,
      })),
    })),
    questions: data.questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      position: q.position,
      choices: (choicesByQ.get(q.id) ?? []).map((c) => ({
        id: c.id,
        text: c.text,
        is_correct: c.isCorrect,
      })),
    })),
  };

  const [latest] = await tdb.run((tx) =>
    tx
      .select({ versionNumber: lmsModuleVersions.versionNumber })
      .from(lmsModuleVersions)
      .where(
        and(
          eq(lmsModuleVersions.moduleId, moduleId),
          tenantWhere(lmsModuleVersions, tenantId),
        ),
      )
      .orderBy(desc(lmsModuleVersions.versionNumber))
      .limit(1),
  );
  const nextNumber = (latest?.versionNumber ?? 0) + 1;

  await tdb.run((tx) =>
    tx.insert(lmsModuleVersions).values({
      moduleId,
      versionNumber: nextNumber,
      snapshotJson: JSON.stringify(snapshot),
      createdById,
      summary,
      traceyTenantId: tenantId,
    }),
  );

  return nextNumber;
}
