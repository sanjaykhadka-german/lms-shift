"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lmsWhsKinds, lmsWhsRecords } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { slugifyKind } from "~/lib/lms/whs-kinds";
import type { FormState } from "../../_components/NameCrudForm";

const createSchema = z.object({
  label: z.string().trim().min(1, "Name is required").max(100, "Too long"),
  category: z.enum(["expiry", "incident"], { errorMap: () => ({ message: "Pick a category" }) }),
});

export async function createWhsKindAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = createSchema.safeParse({
    label: formData.get("label"),
    category: formData.get("category"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { label, category } = parsed.data;
  const slug = slugifyKind(label);
  if (!slug) {
    return {
      status: "error",
      message: "Name needs at least one letter or number.",
      fieldErrors: { label: ["Use letters or numbers."] },
    };
  }

  const row = await ctx.db.run(async (tx) => {
    const existing = await tx
      .select({ id: lmsWhsKinds.id })
      .from(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.slug, slug), tenantWhere(lmsWhsKinds, tid)))
      .limit(1);
    if (existing[0]) return null;
    const dupeLabel = await tx
      .select({ id: lmsWhsKinds.id })
      .from(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.label, label), tenantWhere(lmsWhsKinds, tid)))
      .limit(1);
    if (dupeLabel[0]) return null;
    const [created] = await tx
      .insert(lmsWhsKinds)
      .values({ slug, label, category, isSystem: false, traceyTenantId: tid })
      .returning({ id: lmsWhsKinds.id });
    return created ?? null;
  });
  if (!row) {
    return { status: "error", message: `A kind named '${label}' already exists.` };
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs_kind.created",
    targetKind: "whs_kind",
    targetId: String(row.id),
    details: { slug, label, category },
  });
  revalidatePath("/app/admin/whs/kinds");
  revalidatePath("/app/admin/whs");
  return { status: "ok", message: `Kind '${label}' added.` };
}

export async function deleteWhsKindAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  type DeleteResult =
    | { status: "not_found" }
    | { status: "system"; slug: string; label: string }
    | { status: "in_use"; count: number; slug: string; label: string }
    | { status: "ok"; slug: string; label: string };

  const result: DeleteResult = await ctx.db.run(async (tx) => {
    const [found] = await tx
      .select({
        id: lmsWhsKinds.id,
        slug: lmsWhsKinds.slug,
        label: lmsWhsKinds.label,
        isSystem: lmsWhsKinds.isSystem,
      })
      .from(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.id, id), tenantWhere(lmsWhsKinds, tid)))
      .limit(1);
    if (!found) return { status: "not_found" };
    if (found.isSystem) return { status: "system", slug: found.slug, label: found.label };
    const inUse = await tx
      .select({ id: lmsWhsRecords.id })
      .from(lmsWhsRecords)
      .where(and(eq(lmsWhsRecords.kind, found.slug), tenantWhere(lmsWhsRecords, tid)));
    if (inUse.length > 0) {
      return { status: "in_use", count: inUse.length, slug: found.slug, label: found.label };
    }
    await tx
      .delete(lmsWhsKinds)
      .where(and(eq(lmsWhsKinds.id, id), tenantWhere(lmsWhsKinds, tid)));
    return { status: "ok", slug: found.slug, label: found.label };
  });

  if (result.status === "not_found") throw new Error("Kind not found");
  if (result.status === "system") throw new Error("System kinds cannot be deleted");
  if (result.status === "in_use") {
    throw new Error(
      `${result.count} WHS record${result.count === 1 ? "" : "s"} use this kind — change them first.`,
    );
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "whs_kind.deleted",
    targetKind: "whs_kind",
    targetId: String(id),
    details: { slug: result.slug, label: result.label },
  });
  revalidatePath("/app/admin/whs/kinds");
  revalidatePath("/app/admin/whs");
}
