"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scDocuments, scEmployees } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// 5 MiB — matches the CHECK constraint on sc_documents.file_size and the
// experimental.serverActions.bodySizeLimit in next.config.ts.
const MAX_BYTES = 5 * 1024 * 1024;

// Per-tenant total cap on bytea storage. Render's free Postgres tier caps
// at 1 GB shared across ALL tenants in this DB; capping each tenant well
// below that keeps a single noisy tenant from filling the disk and
// breaking the rest. Bump this when we migrate documents to R2/S3.
const TENANT_STORAGE_CAP_BYTES = 500 * 1024 * 1024;

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Conservative allow-list. Adding to this list is cheap — but accepting
// arbitrary mime types invites trouble (HTML uploads with stored XSS in
// the download stream, etc).
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const baseSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const librarySchema = baseSchema.extend({
  scope: z.literal("library"),
});

const teamSchema = baseSchema.extend({
  scope: z.literal("team"),
  employeeId: z.string().uuid("Pick an employee"),
  expiresAt: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

const uploadSchema = z.discriminatedUnion("scope", [librarySchema, teamSchema]);

export type UploadDocumentState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export async function uploadDocumentAction(
  _prev: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can upload documents.",
    };
  }
  const tenantId = membership.tenant.id;

  const raw = {
    scope: formData.get("scope"),
    title: formData.get("title"),
    notes: formData.get("notes"),
    employeeId: formData.get("employeeId"),
    expiresAt: formData.get("expiresAt"),
  };
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Pick a file to upload.",
      fieldErrors: { file: ["File is required."] },
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      status: "error",
      message: `File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB).`,
      fieldErrors: { file: ["File exceeds 5 MB."] },
    };
  }
  if (!ALLOWED_MIMES.has(file.type)) {
    return {
      status: "error",
      message:
        "Unsupported file type. Allowed: PDF, JPG, PNG, WebP, DOC, DOCX, TXT.",
      fieldErrors: { file: [`MIME type ${file.type || "unknown"} not allowed.`] },
    };
  }

  const data = parsed.data;

  if (data.scope === "team") {
    // Confirm the employee belongs to this tenant — RLS would block a
    // cross-tenant insert via the FK, but failing early returns a clear
    // error rather than a constraint violation.
    const found = await forTenant(tenantId).run((tx) =>
      tx
        .select({ id: scEmployees.id })
        .from(scEmployees)
        .where(eq(scEmployees.id, data.employeeId))
        .limit(1),
    );
    if (found.length === 0) {
      return {
        status: "error",
        message: "Employee not found.",
        fieldErrors: { employeeId: ["Employee not found."] },
      };
    }
  }

  // Per-tenant storage cap check — bytea fills Render's Postgres disk
  // fast; refuse uploads when the tenant is already at its budget.
  const totalRow = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        total: sql<number>`coalesce(sum(${scDocuments.fileSize}), 0)::bigint`,
      })
      .from(scDocuments),
  );
  const usedBytes = Number(totalRow[0]?.total ?? 0);
  if (usedBytes + file.size > TENANT_STORAGE_CAP_BYTES) {
    const remaining = Math.max(0, TENANT_STORAGE_CAP_BYTES - usedBytes);
    return {
      status: "error",
      message: `Workspace storage cap reached (${fmtMB(usedBytes)} of ${fmtMB(TENANT_STORAGE_CAP_BYTES)} used; ${fmtMB(remaining)} remaining). Delete some documents before uploading more.`,
      fieldErrors: {
        file: [`Not enough storage for ${fmtMB(file.size)}; ${fmtMB(remaining)} left.`],
      },
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const expiresAt =
    data.scope === "team" && data.expiresAt ? new Date(data.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return {
      status: "error",
      message: "Expiry date is invalid.",
      fieldErrors: { expiresAt: ["Pick a valid date."] },
    };
  }

  const [inserted] = await forTenant(tenantId).run((tx) =>
    tx
      .insert(scDocuments)
      .values({
        traceyTenantId: tenantId,
        scope: data.scope,
        employeeId: data.scope === "team" ? data.employeeId : null,
        title: data.title,
        notes: data.notes,
        mimeType: file.type,
        fileSize: file.size,
        data: buffer,
        uploadedByUserId: me.id,
        expiresAt,
      })
      .returning({ id: scDocuments.id }),
  );

  await logAuditEvent({
    action: "shiftcraft.document.uploaded",
    targetKind: "sc_document",
    targetId: inserted?.id ?? null,
    details: {
      scope: data.scope,
      title: data.title,
      mimeType: file.type,
      fileSize: file.size,
      employeeId: data.scope === "team" ? data.employeeId : null,
    },
  });

  revalidatePath("/app/people/documents");
  revalidatePath("/app/people/team-documents");
  return { status: "ok", message: `Uploaded "${data.title}".` };
}

const deleteSchema = z.object({
  documentId: z.string().uuid(),
});

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = deleteSchema.safeParse({
    documentId: formData.get("documentId"),
  });
  if (!parsed.success) throw new Error("Invalid document id");

  const removed = await forTenant(tenantId).run(async (tx) => {
    const [target] = await tx
      .select({
        id: scDocuments.id,
        scope: scDocuments.scope,
        title: scDocuments.title,
      })
      .from(scDocuments)
      .where(eq(scDocuments.id, parsed.data.documentId))
      .limit(1);
    if (!target) return null;

    await tx
      .delete(scDocuments)
      .where(
        and(
          eq(scDocuments.id, parsed.data.documentId),
          eq(scDocuments.traceyTenantId, tenantId),
        ),
      );
    return target;
  });

  if (removed) {
    await logAuditEvent({
      action: "shiftcraft.document.deleted",
      targetKind: "sc_document",
      targetId: removed.id,
      details: { scope: removed.scope, title: removed.title },
    });
  }

  revalidatePath("/app/people/documents");
  revalidatePath("/app/people/team-documents");
}
