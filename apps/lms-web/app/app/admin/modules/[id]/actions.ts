"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  lmsModuleMedia,
  lmsModules,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { snapshotModuleVersion } from "~/lib/lms/module-versions";
import {
  deleteStoredPhoto,
  PhotoUploadError,
  saveBinaryUpload,
} from "~/lib/lms/photos";

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  title: z.string().trim().min(1, "Title is required").max(255),
  description: z.string().optional(),
  validForDays: z.string().optional(),
  isPublished: z.string().optional(),
});

async function ownedModule(id: number, tid: string) {
  const [row] = await forTenant(tid).run((tx) =>
    tx
      .select()
      .from(lmsModules)
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid)))
      .limit(1),
  );
  return row ?? null;
}

export async function updateModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    validForDays: formData.get("valid_for_days") ?? "",
    isPublished: formData.get("is_published") ?? "",
  });
  if (!parsed.success) throw new Error("Invalid module form");

  const target = await ownedModule(parsed.data.id, tid);
  if (!target) throw new Error("Module not found");

  const validForDays =
    parsed.data.validForDays && /^\d+$/.test(parsed.data.validForDays)
      ? parseInt(parsed.data.validForDays, 10)
      : null;

  await ctx.db.run((tx) =>
    tx
      .update(lmsModules)
      .set({
        title: parsed.data.title,
        description: parsed.data.description ?? "",
        validForDays,
        isPublished: parsed.data.isPublished === "1",
      })
      .where(and(eq(lmsModules.id, parsed.data.id), tenantWhere(lmsModules, tid))),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.updated",
    targetKind: "module",
    targetId: String(parsed.data.id),
    details: { title: parsed.data.title, isPublished: parsed.data.isPublished === "1" },
  });
  revalidatePath(`/app/admin/modules/${parsed.data.id}`);
  redirect(`/app/admin/modules/${parsed.data.id}?saved=1`);
}

// â”€â”€â”€ Cover â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function setModuleCoverAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");
  const target = await ownedModule(id, tid);
  if (!target) throw new Error("Module not found");

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/admin/modules/${id}?error=cover_empty`);
  }

  let stored: string;
  try {
    stored = await saveBinaryUpload({
      file: file as File,
      prefix: "cover_",
      uploadedByLmsUserId: ctx.lmsUser.id,
      traceyTenantId: tid,
    });
  } catch (err) {
    if (err instanceof PhotoUploadError) {
      redirect(`/app/admin/modules/${id}?error=cover&msg=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  const previous = target.coverPath ?? "";
  await ctx.db.run((tx) =>
    tx
      .update(lmsModules)
      .set({ coverPath: stored })
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid))),
  );
  if (previous && previous !== stored) await deleteStoredPhoto(previous, tid);

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.cover_set",
    targetKind: "module",
    targetId: String(id),
  });
  revalidatePath(`/app/admin/modules/${id}`);
  redirect(`/app/admin/modules/${id}?saved=cover`);
}

export async function clearModuleCoverAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");
  const target = await ownedModule(id, tid);
  if (!target) throw new Error("Module not found");

  const previous = target.coverPath ?? "";
  await ctx.db.run((tx) =>
    tx
      .update(lmsModules)
      .set({ coverPath: "" })
      .where(and(eq(lmsModules.id, id), tenantWhere(lmsModules, tid))),
  );
  if (previous) await deleteStoredPhoto(previous, tid);

  revalidatePath(`/app/admin/modules/${id}`);
}

// â”€â”€â”€ Module-level media â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function addModuleMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");
  if (!(await ownedModule(id, tid))) throw new Error("Module not found");

  const file = formData.get("media");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/app/admin/modules/${id}?error=media_empty`);
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
      redirect(`/app/admin/modules/${id}?error=media&msg=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  const dot = stored.lastIndexOf(".");
  const ext = dot >= 0 ? stored.slice(dot + 1).toLowerCase() : "";
  const kind = ["mp4", "mov", "webm"].includes(ext) ? "video" : "image";

  await ctx.db.run((tx) =>
    tx.insert(lmsModuleMedia).values({
      moduleId: id,
      filePath: stored,
      kind,
      position: 0,
      traceyTenantId: tid,
    }),
  );
  revalidatePath(`/app/admin/modules/${id}`);
}

export async function removeModuleMediaAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  const mediaId = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(moduleId) || !Number.isFinite(mediaId)) throw new Error("Bad id");
  if (!(await ownedModule(moduleId, tid))) throw new Error("Module not found");

  const [target] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsModuleMedia)
      .where(and(eq(lmsModuleMedia.id, mediaId), tenantWhere(lmsModuleMedia, tid)))
      .limit(1),
  );
  if (!target) return;

  await ctx.db.run((tx) =>
    tx
      .delete(lmsModuleMedia)
      .where(and(eq(lmsModuleMedia.id, mediaId), tenantWhere(lmsModuleMedia, tid))),
  );
  if (target.filePath) await deleteStoredPhoto(target.filePath, tid);

  void ctx;
  revalidatePath(`/app/admin/modules/${moduleId}`);
}

// â”€â”€â”€ Version snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function saveModuleVersionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  const summary = String(formData.get("summary") ?? "").trim().slice(0, 255);
  if (!Number.isFinite(id)) throw new Error("Bad id");
  const m = await ownedModule(id, tid);
  if (!m) throw new Error("Module not found");

  const nextNumber = await snapshotModuleVersion({
    tdb: ctx.db,
    moduleId: id,
    tenantId: tid,
    createdById: ctx.lmsUser.id,
    summary,
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.version_saved",
    targetKind: "module",
    targetId: String(id),
    details: { versionNumber: nextNumber, summary },
  });
  revalidatePath(`/app/admin/modules/${id}`);
  redirect(`/app/admin/modules/${id}?saved=version&v=${nextNumber}`);
}
