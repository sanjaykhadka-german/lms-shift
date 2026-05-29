"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lmsEmployers, lmsUsers } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

const nameSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Too long"),
});

export async function createEmployerAction(_prev: FormState, formData: FormData): Promise<FormState> {
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
      .select({ id: lmsEmployers.id })
      .from(lmsEmployers)
      .where(and(eq(lmsEmployers.name, name), tenantWhere(lmsEmployers, tid)))
      .limit(1);
    if (existing[0]) return null;
    const [r] = await tx
      .insert(lmsEmployers)
      .values({ name, traceyTenantId: tid })
      .returning({ id: lmsEmployers.id });
    return r ?? null;
  });
  if (!row) {
    return { status: "error", message: `Employer '${name}' already exists.` };
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employer.created",
    targetKind: "employer",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/employers");
  return { status: "ok", message: `Employer '${name}' added.` };
}

export async function deleteEmployerAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [t] = await tx
      .select({ id: lmsEmployers.id, name: lmsEmployers.name })
      .from(lmsEmployers)
      .where(and(eq(lmsEmployers.id, id), tenantWhere(lmsEmployers, tid)))
      .limit(1);
    if (!t) return null;

    await tx
      .update(lmsUsers)
      .set({ employerId: null })
      .where(and(eq(lmsUsers.employerId, id), eq(lmsUsers.traceyTenantId, tid)));
    await tx
      .delete(lmsEmployers)
      .where(and(eq(lmsEmployers.id, id), tenantWhere(lmsEmployers, tid)));
    return t;
  });
  if (!target) throw new Error("Employer not found");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "employer.deleted",
    targetKind: "employer",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/employers");
}
