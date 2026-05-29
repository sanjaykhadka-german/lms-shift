"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import {
  lmsChoices,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export async function addQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return;
  const kind = formData.get("kind") === "multi" ? "multi" : "single";

  const newId = await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    const [last] = await tx
      .select({ position: lmsQuestions.position })
      .from(lmsQuestions)
      .where(and(eq(lmsQuestions.moduleId, moduleId), tenantWhere(lmsQuestions, tid)))
      .orderBy(desc(lmsQuestions.position))
      .limit(1);
    const nextPosition = (last?.position ?? 0) + 10;

    const [row] = await tx
      .insert(lmsQuestions)
      .values({
        moduleId,
        prompt,
        kind,
        position: nextPosition,
        traceyTenantId: tid,
      })
      .returning({ id: lmsQuestions.id });
    return row?.id;
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.added",
    targetKind: "question",
    targetId: String(newId ?? ""),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) return;
  const kind = formData.get("kind") === "multi" ? "multi" : "single";

  await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    await tx
      .update(lmsQuestions)
      .set({ prompt, kind })
      .where(
        and(
          eq(lmsQuestions.id, id),
          eq(lmsQuestions.moduleId, moduleId),
          tenantWhere(lmsQuestions, tid),
        ),
      );
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.updated",
    targetKind: "question",
    targetId: String(id),
    details: { moduleId },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteQuestionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    // FK cascades on choices drop their rows.
    await tx
      .delete(lmsQuestions)
      .where(
        and(
          eq(lmsQuestions.id, id),
          eq(lmsQuestions.moduleId, moduleId),
          tenantWhere(lmsQuestions, tid),
        ),
      );
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "question.deleted",
    targetKind: "question",
    targetId: String(id),
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

// â”€â”€â”€ Choices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function addChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const questionId = parseInt(String(formData.get("question_id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(questionId) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  const isCorrect = formData.get("is_correct") === "1";

  await ctx.db.run(async (tx) => {
    const [q] = await tx
      .select({ id: lmsQuestions.id })
      .from(lmsQuestions)
      .where(
        and(
          eq(lmsQuestions.id, questionId),
          eq(lmsQuestions.moduleId, moduleId),
          tenantWhere(lmsQuestions, tid),
        ),
      )
      .limit(1);
    if (!q) throw new Error("Question not found");

    const [last] = await tx
      .select({ position: lmsChoices.position })
      .from(lmsChoices)
      .where(and(eq(lmsChoices.questionId, questionId), tenantWhere(lmsChoices, tid)))
      .orderBy(desc(lmsChoices.position))
      .limit(1);
    const nextPosition = (last?.position ?? 0) + 10;

    await tx.insert(lmsChoices).values({
      questionId,
      text,
      isCorrect,
      position: nextPosition,
      traceyTenantId: tid,
    });
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  const text = String(formData.get("text") ?? "").trim();
  if (!text) return;
  const isCorrect = formData.get("is_correct") === "1";

  await ctx.db.run(async (tx) => {
    // Verify the choice belongs to a question in this module + tenant.
    const [choice] = await tx
      .select({ id: lmsChoices.id, questionId: lmsChoices.questionId })
      .from(lmsChoices)
      .innerJoin(lmsQuestions, eq(lmsQuestions.id, lmsChoices.questionId))
      .where(
        and(
          eq(lmsChoices.id, id),
          eq(lmsQuestions.moduleId, moduleId),
          tenantWhere(lmsChoices, tid),
        ),
      )
      .limit(1);
    if (!choice) throw new Error("Choice not found");

    await tx
      .update(lmsChoices)
      .set({ text, isCorrect })
      .where(and(eq(lmsChoices.id, id), tenantWhere(lmsChoices, tid)));
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteChoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  await ctx.db.run((tx) =>
    tx
      .delete(lmsChoices)
      .where(and(eq(lmsChoices.id, id), tenantWhere(lmsChoices, tid))),
  );
  revalidatePath(`/app/admin/modules/${moduleId}`);
}
