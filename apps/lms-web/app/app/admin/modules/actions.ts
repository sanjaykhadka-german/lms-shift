"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  lmsChoices,
  lmsContentItemMedia,
  lmsContentItems,
  lmsModuleMedia,
  lmsModules,
  lmsQuestions,
} from "@tracey/db";
import { requireAdmin } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

const createSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
});

export async function createModuleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const parsed = createSchema.safeParse({ title: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: parsed.error.flatten().fieldErrors.title ?? [] },
    };
  }

  const [row] = await ctx.db.run((tx) =>
    tx
      .insert(lmsModules)
      .values({
        title: parsed.data.title,
        isPublished: false,
        createdById: ctx.lmsUser.id,
        traceyTenantId: tid,
      })
      .returning({ id: lmsModules.id }),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.created",
    targetKind: "module",
    targetId: String(row?.id ?? ""),
    details: { title: parsed.data.title },
  });
  revalidatePath("/app/admin/modules");
  if (row?.id) redirect(`/app/admin/modules/${row.id}`);
  return { status: "ok", message: "Module created." };
}

// Deep-copies a module and everything under it (content items + their media,
// module media, questions + choices) as a new unpublished draft, in one
// tenant-scoped transaction. Assignments and attempts are intentionally NOT
// copied — the clone starts with a clean completion history.
export async function cloneModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const newId = await ctx.db.run(async (tx) => {
    const [src] = await tx
      .select()
      .from(lmsModules)
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!src) return null;

    const [mod] = await tx
      .insert(lmsModules)
      .values({
        title: `Copy of ${src.title}`,
        description: src.description,
        isPublished: false,
        createdById: ctx.lmsUser.id,
        coverPath: src.coverPath,
        validForDays: src.validForDays,
        traceyTenantId: tid,
      })
      .returning({ id: lmsModules.id });
    const newModuleId = mod!.id;

    // Module-level media.
    const moduleMedia = await tx
      .select()
      .from(lmsModuleMedia)
      .where(and(eq(lmsModuleMedia.moduleId, id), tenantWhere(lmsModuleMedia, tid)));
    if (moduleMedia.length > 0) {
      await tx.insert(lmsModuleMedia).values(
        moduleMedia.map((m) => ({
          moduleId: newModuleId,
          filePath: m.filePath,
          kind: m.kind,
          position: m.position,
          traceyTenantId: tid,
        })),
      );
    }

    // Content items + their media (per-item, to remap the FK).
    const contentItems = await tx
      .select()
      .from(lmsContentItems)
      .where(and(eq(lmsContentItems.moduleId, id), tenantWhere(lmsContentItems, tid)));
    for (const ci of contentItems) {
      const [newCi] = await tx
        .insert(lmsContentItems)
        .values({
          moduleId: newModuleId,
          kind: ci.kind,
          title: ci.title,
          body: ci.body,
          filePath: ci.filePath,
          position: ci.position,
          traceyTenantId: tid,
        })
        .returning({ id: lmsContentItems.id });
      const media = await tx
        .select()
        .from(lmsContentItemMedia)
        .where(
          and(
            eq(lmsContentItemMedia.contentItemId, ci.id),
            tenantWhere(lmsContentItemMedia, tid),
          ),
        );
      if (media.length > 0) {
        await tx.insert(lmsContentItemMedia).values(
          media.map((m) => ({
            contentItemId: newCi!.id,
            filePath: m.filePath,
            kind: m.kind,
            position: m.position,
            traceyTenantId: tid,
          })),
        );
      }
    }

    // Questions + choices (per-question, to remap the FK).
    const questions = await tx
      .select()
      .from(lmsQuestions)
      .where(and(eq(lmsQuestions.moduleId, id), tenantWhere(lmsQuestions, tid)));
    for (const q of questions) {
      const [newQ] = await tx
        .insert(lmsQuestions)
        .values({
          moduleId: newModuleId,
          prompt: q.prompt,
          kind: q.kind,
          position: q.position,
          traceyTenantId: tid,
        })
        .returning({ id: lmsQuestions.id });
      const choices = await tx
        .select()
        .from(lmsChoices)
        .where(and(eq(lmsChoices.questionId, q.id), tenantWhere(lmsChoices, tid)));
      if (choices.length > 0) {
        await tx.insert(lmsChoices).values(
          choices.map((c) => ({
            questionId: newQ!.id,
            text: c.text,
            isCorrect: c.isCorrect,
            position: c.position,
            traceyTenantId: tid,
          })),
        );
      }
    }

    return newModuleId;
  });

  if (newId == null) redirect("/app/admin/modules");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.cloned",
    targetKind: "module",
    targetId: String(newId),
    details: { sourceId: id },
  });
  revalidatePath("/app/admin/modules");
  redirect(`/app/admin/modules/${newId}`);
}

export async function deleteModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [t] = await tx
      .select({ id: lmsModules.id, title: lmsModules.title })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!t) return null;
    // FK cascades on content_items, questions, assignments, etc.
    await tx
      .delete(lmsModules)
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)));
    return t;
  });
  if (!target) throw new Error("Module not found");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.deleted",
    targetKind: "module",
    targetId: String(id),
    details: { title: target.title },
  });
  revalidatePath("/app/admin/modules");
}
