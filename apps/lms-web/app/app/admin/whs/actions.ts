"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lmsWhsKinds, lmsWhsRecords } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { deleteStoredPhoto, PhotoUploadError, saveBinaryUpload } from "~/lib/lms/photos";
import { tenantWhere } from "~/lib/lms/tenant-scope";

const VALID_SEVERITIES = new Set(["low", "medium", "high", "critical"]);

const dateOpt = z
  .string()
  .optional()
  .transform((s) => {
    if (!s) return null;
    const t = s.trim();
    if (!t) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      throw new z.ZodError([
        { code: "custom", path: ["date"], message: "Use YYYY-MM-DD" },
      ]);
    }
    return t;
  });

const whsSchema = z.object({
  kind: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  userId: z.string().optional(),
  issuedOn: dateOpt.optional(),
  expiresOn: dateOpt.optional(),
  notes: z.string().optional(),
  incidentDate: dateOpt.optional(),
  severity: z.string().optional(),
  reportedById: z.string().optional(),
});

function intOrNull(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

function fileOrNull(raw: FormDataEntryValue | null): File | null {
  if (!raw || typeof raw === "string") return null;
  if (raw.size === 0) return null;
  return raw;
}

export async function createWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  let parsed;
  try {
    parsed = whsSchema.safeParse({
      kind: formData.get("kind"),
      title: formData.get("title"),
      userId: String(formData.get("user_id") ?? ""),
      issuedOn: formData.get("issued_on") ?? "",
      expiresOn: formData.get("expires_on") ?? "",
      notes: formData.get("notes") ?? "",
      incidentDate: formData.get("incident_date") ?? "",
      severity: formData.get("severity") ?? "",
      reportedById: String(formData.get("reported_by_id") ?? ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) redirect("/app/admin/whs/new?error=date");
    throw err;
  }
  if (!parsed.success) redirect("/app/admin/whs/new?error=invalid");
  const data = parsed.data;

  const [kindRow] = await ctx.db.run((tx) =>
    tx
      .select({ slug: lmsWhsKinds.slug, category: lmsWhsKinds.category })
      .from(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.slug, data.kind), tenantWhere(lmsWhsKinds, tid)))
      .limit(1),
  );
  if (!kindRow) redirect("/app/admin/whs/new?error=invalid");

  const severity =
    kindRow.category === "incident" &&
    data.severity &&
    VALID_SEVERITIES.has(data.severity)
      ? data.severity
      : null;

  let documentFilename: string | null = null;
  const file = fileOrNull(formData.get("document"));
  if (file) {
    try {
      documentFilename = await saveBinaryUpload({
        file,
        prefix: "whs_",
        uploadedByLmsUserId: ctx.lmsUser.id,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) redirect("/app/admin/whs/new?error=upload");
      throw err;
    }
  }

  const [row] = await ctx.db.run((tx) =>
    tx
      .insert(lmsWhsRecords)
      .values({
        kind: data.kind,
        title: data.title,
        userId: intOrNull(formData.get("user_id")),
        issuedOn: data.issuedOn ?? null,
        expiresOn: data.expiresOn ?? null,
        notes: data.notes ?? "",
        incidentDate: kindRow.category === "incident" ? data.incidentDate ?? null : null,
        severity,
        reportedById:
          kindRow.category === "incident" ? intOrNull(formData.get("reported_by_id")) : null,
        documentFilename,
        traceyTenantId: tid,
      })
      .returning({ id: lmsWhsRecords.id }),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.created",
    targetKind: "whs_record",
    targetId: String(row?.id ?? ""),
    details: { kind: data.kind, title: data.title, hasDocument: documentFilename !== null },
  });
  revalidatePath("/app/admin/whs");
  redirect("/app/admin/whs?ok=created");
}

export async function updateWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = intOrNull(formData.get("id"));
  if (!id) throw new Error("Bad id");

  let parsed;
  try {
    parsed = whsSchema.safeParse({
      kind: formData.get("kind"),
      title: formData.get("title"),
      userId: String(formData.get("user_id") ?? ""),
      issuedOn: formData.get("issued_on") ?? "",
      expiresOn: formData.get("expires_on") ?? "",
      notes: formData.get("notes") ?? "",
      incidentDate: formData.get("incident_date") ?? "",
      severity: formData.get("severity") ?? "",
      reportedById: String(formData.get("reported_by_id") ?? ""),
    });
  } catch (err) {
    if (err instanceof z.ZodError) redirect(`/app/admin/whs/${id}/edit?error=date`);
    throw err;
  }
  if (!parsed.success) redirect(`/app/admin/whs/${id}/edit?error=invalid`);
  const data = parsed.data;

  const [kindRow] = await ctx.db.run((tx) =>
    tx
      .select({ slug: lmsWhsKinds.slug, category: lmsWhsKinds.category })
      .from(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.slug, data.kind), tenantWhere(lmsWhsKinds, tid)))
      .limit(1),
  );
  if (!kindRow) redirect(`/app/admin/whs/${id}/edit?error=invalid`);

  const severity =
    kindRow.category === "incident" &&
    data.severity &&
    VALID_SEVERITIES.has(data.severity)
      ? data.severity
      : null;

  const [existing] = await ctx.db.run((tx) =>
    tx
      .select({ documentFilename: lmsWhsRecords.documentFilename })
      .from(lmsWhsRecords)
      .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)))
      .limit(1),
  );
  if (!existing) throw new Error("Record not found");

  let documentFilename: string | null = existing.documentFilename ?? null;
  const file = fileOrNull(formData.get("document"));
  if (file) {
    try {
      documentFilename = await saveBinaryUpload({
        file,
        prefix: "whs_",
        uploadedByLmsUserId: ctx.lmsUser.id,
        traceyTenantId: tid,
      });
    } catch (err) {
      if (err instanceof PhotoUploadError) redirect(`/app/admin/whs/${id}/edit?error=upload`);
      throw err;
    }
    if (existing.documentFilename && existing.documentFilename !== documentFilename) {
      try {
        await deleteStoredPhoto(existing.documentFilename, tid);
      } catch (err) {
        console.error("[whs] failed to delete previous document:", err);
      }
    }
  }

  await ctx.db.run((tx) =>
    tx
      .update(lmsWhsRecords)
      .set({
        kind: data.kind,
        title: data.title,
        userId: intOrNull(formData.get("user_id")),
        issuedOn: data.issuedOn ?? null,
        expiresOn: data.expiresOn ?? null,
        notes: data.notes ?? "",
        incidentDate: kindRow.category === "incident" ? data.incidentDate ?? null : null,
        severity,
        reportedById:
          kindRow.category === "incident" ? intOrNull(formData.get("reported_by_id")) : null,
        documentFilename,
      })
      .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid))),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.updated",
    targetKind: "whs_record",
    targetId: String(id),
    details: { kind: data.kind, title: data.title, hasDocument: documentFilename !== null },
  });
  revalidatePath("/app/admin/whs");
  redirect("/app/admin/whs?ok=updated");
}

export async function deleteWhsRecordAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = intOrNull(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [t] = await tx
      .select({ title: lmsWhsRecords.title, documentFilename: lmsWhsRecords.documentFilename })
      .from(lmsWhsRecords)
      .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)))
      .limit(1);
    if (!t) return null;
    await tx
      .delete(lmsWhsRecords)
      .where(and(eq(lmsWhsRecords.id, id), tenantWhere(lmsWhsRecords, tid)));
    return t;
  });
  if (!target) return;

  if (target.documentFilename) {
    try {
      await deleteStoredPhoto(target.documentFilename, tid);
    } catch (err) {
      console.error("[whs] failed to delete document on record delete:", err);
    }
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs.deleted",
    targetKind: "whs_record",
    targetId: String(id),
    details: { title: target.title },
  });
  revalidatePath("/app/admin/whs");
}
