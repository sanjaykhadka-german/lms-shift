"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lmsDepartments, lmsUsers } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

// Worked example for the tenant-scoped query pattern. All db work for
// LMS tables runs through `ctx.db.run((tx) => ...)` so the transaction
// has `app.tenant_id` set for Postgres RLS (migration 0004). The
// explicit tenantWhere() filters are kept as belt-and-suspenders.

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const nameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Too long"),
});

export async function createDepartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const name = parsed.data.name;

  const row = await ctx.db.run(async (tx) => {
    const existing = await tx
      .select({ id: lmsDepartments.id })
      .from(lmsDepartments)
      .where(and(eq(lmsDepartments.name, name), tenantWhere(lmsDepartments, tid)))
      .limit(1);
    if (existing[0]) return null;

    const [created] = await tx
      .insert(lmsDepartments)
      .values({ name, traceyTenantId: tid })
      .returning({ id: lmsDepartments.id });
    return created ?? null;
  });
  if (!row) {
    return { status: "error", message: `Department '${name}' already exists.` };
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.created",
    targetKind: "department",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/departments");
  return { status: "ok", message: `Department '${name}' added.` };
}

export async function deleteDepartmentAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  // Reassign users with this department to NULL â€” matches Flask delete path
  // (app.py:3351). Done in one tx so a partial fail leaves nothing dangling.
  const target = await ctx.db.run(async (tx) => {
    const [found] = await tx
      .select({ id: lmsDepartments.id, name: lmsDepartments.name })
      .from(lmsDepartments)
      .where(and(eq(lmsDepartments.id, id), tenantWhere(lmsDepartments, tid)))
      .limit(1);
    if (!found) return null;
    await tx
      .update(lmsUsers)
      .set({ departmentId: null })
      .where(and(eq(lmsUsers.departmentId, id), eq(lmsUsers.traceyTenantId, tid)));
    await tx
      .delete(lmsDepartments)
      .where(and(eq(lmsDepartments.id, id), tenantWhere(lmsDepartments, tid)));
    return found;
  });
  if (!target) throw new Error("Department not found");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.deleted",
    targetKind: "department",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/departments");
}
