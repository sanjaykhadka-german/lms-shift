"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import {
  lmsContentItemMedia,
  lmsContentItems,
  lmsModules,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import {
  deleteStoredPhoto,
  PhotoUploadError,
  saveBinaryUpload,
} from "~/lib/lms/photos";

const VALID_KINDS = new Set([
  "story",
  "scenario",
  "takeaway",
  "section",
  "text",
  "link",
  "pdf",
  "doc",
  "audio",
  "video",
  "image",
]);

// Re-serialise the body field set into the on-disk shape that
// loadLiveModule (lib/lms/learner.ts) and Flask's templates parse:
//   section  â†’ JSON { body, bullets, groups }
//   scenario â†’ JSON { body, answerBody }
//   else     â†’ plain text in the body column
function serialiseBody(kind: string, formData: FormData): string {
  const bodyText = String(formData.get("body") ?? "");
  if (kind === "section") {
    const bullets = formData
      .getAll("bullet")
      .map((b) => String(b))
      .filter((s) => s.trim().length > 0);
    let groups: unknown[] = [];
    const rawGroups = formData.get("groups_json");
    if (typeof rawGroups === "string" && rawGroups.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(rawGroups);
        if (Array.isArray(parsed)) groups = parsed;
      } catch {
        groups = [];
      }
    }
    return JSON.stringify({ body: bodyText, bullets, groups });
  }
  if (kind === "scenario") {
    const answerBody = String(formData.get("answer_body") ?? "");
    return JSON.stringify({ body: bodyText, answerBody });
  }
  return bodyText;
}

export async function addContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");

  const kind = String(formData.get("kind") ?? "section");
  if (!VALID_KINDS.has(kind)) throw new Error("Invalid kind");
  const title = String(formData.get("title") ?? "New section").slice(0, 255) || "New section";

  const newId = await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    const [last] = await tx
      .select({ position: lmsContentItems.position })
      .from(lmsContentItems)
      .where(
        and(eq(lmsContentItems.moduleId, moduleId), tenantWhere(lmsContentItems, tid)),
      )
      .orderBy(desc(lmsContentItems.position))
      .limit(1);
    const nextPosition = (last?.position ?? 0) + 10;

    const [row] = await tx
      .insert(lmsContentItems)
      .values({
        moduleId,
        kind,
        title,
        body: "",
        filePath: "",
        position: nextPosition,
        traceyTenantId: tid,
      })
      .returning({ id: lmsContentItems.id });
    return row?.id;
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.added",
    targetKind: "content_item",
    targetId: String(newId ?? ""),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function updateContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  // Load target outside the write transaction so we have its filePath for
  // the optional file replacement before we hold any row locks.
  const target = await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    const [row] = await tx
      .select()
      .from(lmsContentItems)
      .where(
        and(
          eq(lmsContentItems.id, id),
          eq(lmsContentItems.moduleId, moduleId),
          tenantWhere(lmsContentItems, tid),
        ),
      )
      .limit(1);
    return row;
  });
  if (!target) throw new Error("Content not found");

  const kind = String(formData.get("kind") ?? target.kind);
  const title = String(formData.get("title") ?? "").trim().slice(0, 255);
  const body = serialiseBody(kind, formData);

  // Optional new file replaces the existing one.
  const file = formData.get("file");
  let filePath = target.filePath ?? "";
  if (file instanceof File && file.size > 0) {
    try {
      filePath = await saveBinaryUpload({
        file,
        prefix: "content_",
        uploadedByLmsUserId: ctx.lmsUser.id,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) {
        redirect(
          `/app/admin/modules/${moduleId}?error=content_upload&msg=${encodeURIComponent(
            err.message,
          )}#content-${id}`,
        );
      }
      throw err;
    }
    if (target.filePath && target.filePath !== filePath) {
      await deleteStoredPhoto(target.filePath, tid);
    }
  } else if (formData.get("clear_file") === "1" && target.filePath) {
    await deleteStoredPhoto(target.filePath, tid);
    filePath = "";
  }

  await ctx.db.run((tx) =>
    tx
      .update(lmsContentItems)
      .set({ kind, title, body, filePath })
      .where(
        and(eq(lmsContentItems.id, id), tenantWhere(lmsContentItems, tid)),
      ),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.updated",
    targetKind: "content_item",
    targetId: String(id),
    details: { moduleId, kind },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function deleteContentItemAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  const result = await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    const [target] = await tx
      .select()
      .from(lmsContentItems)
      .where(
        and(
          eq(lmsContentItems.id, id),
          eq(lmsContentItems.moduleId, moduleId),
          tenantWhere(lmsContentItems, tid),
        ),
      )
      .limit(1);
    if (!target) return null;

    // Cascade-collect file_paths so we can delete the BYTEA rows after the
    // FK cascade drops the metadata.
    const media = await tx
      .select({ filePath: lmsContentItemMedia.filePath })
      .from(lmsContentItemMedia)
      .where(
        and(
          eq(lmsContentItemMedia.contentItemId, id),
          tenantWhere(lmsContentItemMedia, tid),
        ),
      );

    await tx
      .delete(lmsContentItems)
      .where(and(eq(lmsContentItems.id, id), tenantWhere(lmsContentItems, tid)));

    return { target, media };
  });
  if (!result) return;

  if (result.target.filePath) await deleteStoredPhoto(result.target.filePath, tid);
  for (const m of result.media) {
    if (m.filePath) await deleteStoredPhoto(m.filePath, tid);
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "content.deleted",
    targetKind: "content_item",
    targetId: String(id),
    details: { moduleId },
  });
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

// â”€â”€â”€ Per-content-item media â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function addContentMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const contentItemId = parseInt(String(formData.get("content_item_id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(contentItemId) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  // Module ownership check before doing the upload.
  await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");
  });

  const file = formData.get("media");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/admin/modules/${moduleId}?error=media_empty#content-${contentItemId}`);
  }

  let stored: string;
  try {
    stored = await saveBinaryUpload({
      file: file as File,
      prefix: "media_",
      uploadedByLmsUserId: ctx.lmsUser.id,
      traceyTenantId: tid,
    });
  } catch (err) {
    if (err instanceof PhotoUploadError) {
      redirect(
        `/app/admin/modules/${moduleId}?error=media&msg=${encodeURIComponent(err.message)}#content-${contentItemId}`,
      );
    }
    throw err;
  }

  const ext = stored.slice(stored.lastIndexOf(".") + 1).toLowerCase();
  const kind = ["mp4", "mov", "webm"].includes(ext) ? "video" : "image";

  await ctx.db.run((tx) =>
    tx.insert(lmsContentItemMedia).values({
      contentItemId,
      filePath: stored,
      kind,
      position: 0,
      traceyTenantId: tid,
    }),
  );
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

export async function removeContentMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(id) || !Number.isFinite(moduleId)) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [m] = await tx
      .select({ id: lmsModules.id })
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1);
    if (!m) throw new Error("Module not found");

    const [row] = await tx
      .select()
      .from(lmsContentItemMedia)
      .where(and(eq(lmsContentItemMedia.id, id), tenantWhere(lmsContentItemMedia, tid)))
      .limit(1);
    if (!row) return null;

    await tx
      .delete(lmsContentItemMedia)
      .where(and(eq(lmsContentItemMedia.id, id), tenantWhere(lmsContentItemMedia, tid)));
    return row;
  });
  if (!target) return;

  if (target.filePath) await deleteStoredPhoto(target.filePath, tid);
  revalidatePath(`/app/admin/modules/${moduleId}`);
}
