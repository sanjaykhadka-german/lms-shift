"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { lmsMachineModules, lmsMachines, lmsModules } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

export async function createMachineAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = z
    .object({ name: z.string().trim().min(1, "Name is required").max(100) })
    .safeParse({ name: formData.get("name") });
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
      .select({ id: lmsMachines.id })
      .from(lmsMachines)
      .where(and(eq(lmsMachines.name, name), tenantWhere(lmsMachines, tid)))
      .limit(1);
    if (existing[0]) return null;
    const [r] = await tx
      .insert(lmsMachines)
      .values({ name, traceyTenantId: tid })
      .returning({ id: lmsMachines.id });
    return r ?? null;
  });
  if (!row) {
    return { status: "error", message: `Machine '${name}' already exists.` };
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.created",
    targetKind: "machine",
    targetId: String(row?.id ?? ""),
    details: { name },
  });
  revalidatePath("/app/admin/machines");
  return { status: "ok", message: `Machine '${name}' added.` };
}

const updateSchema = z.object({
  id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, "Name is required").max(100),
  departmentId: z.string().optional(),
  moduleIds: z.array(z.string()).default([]),
});

export async function updateMachineAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    departmentId: formData.get("department_id") ?? "",
    moduleIds: formData.getAll("module_ids").map(String),
  });
  if (!parsed.success) throw new Error("Invalid machine form");
  const { id, name } = parsed.data;
  const departmentId = parsed.data.departmentId && /^\d+$/.test(parsed.data.departmentId)
    ? parseInt(parsed.data.departmentId, 10)
    : null;
  const moduleIds = parsed.data.moduleIds.filter((s) => /^\d+$/.test(s)).map((s) => parseInt(s, 10));

  // Verify ownership + duplicate-name check in one tenant-scoped tx.
  const checks = await ctx.db.run(async (tx) => {
    const [owned] = await tx
      .select({ id: lmsMachines.id })
      .from(lmsMachines)
      .where(and(eq(lmsMachines.id, id), tenantWhere(lmsMachines, tid)))
      .limit(1);
    if (!owned) return { owned: false, dupe: false };
    const [dupe] = await tx
      .select({ id: lmsMachines.id })
      .from(lmsMachines)
      .where(and(eq(lmsMachines.name, name), ne(lmsMachines.id, id), tenantWhere(lmsMachines, tid)))
      .limit(1);
    return { owned: true, dupe: Boolean(dupe) };
  });
  if (!checks.owned) throw new Error("Machine not found");
  if (checks.dupe) {
    redirect(`/app/admin/machines/${id}/edit?error=duplicate`);
  }

  // Sync the M2M to exactly the chosen module ids â€” clear-and-reinsert is
  // simpler than diffing and is fine for a small set.
  await ctx.db.run(async (tx) => {
    await tx
      .update(lmsMachines)
      .set({ name, departmentId })
      .where(and(eq(lmsMachines.id, id), tenantWhere(lmsMachines, tid)));
    await tx
      .delete(lmsMachineModules)
      .where(
        and(eq(lmsMachineModules.machineId, id), tenantWhere(lmsMachineModules, tid)),
      );
    if (moduleIds.length > 0) {
      // Defensive filter: only link to modules in this tenant.
      const realModules = await tx
        .select({ id: lmsModules.id })
        .from(lmsModules)
        .where(and(inArray(lmsModules.id, moduleIds), tenantWhere(lmsModules, tid)));
      const realIds = realModules.map((r) => r.id);
      if (realIds.length > 0) {
        await tx.insert(lmsMachineModules).values(
          realIds.map((moduleId) => ({ machineId: id, moduleId, traceyTenantId: tid })),
        );
      }
    }
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.updated",
    targetKind: "machine",
    targetId: String(id),
    details: { name, moduleIdsLinked: moduleIds.length },
  });
  revalidatePath("/app/admin/machines");
  redirect("/app/admin/machines");
}

export async function deleteMachineAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [t] = await tx
      .select({ id: lmsMachines.id, name: lmsMachines.name })
      .from(lmsMachines)
      .where(and(eq(lmsMachines.id, id), tenantWhere(lmsMachines, tid)))
      .limit(1);
    if (!t) return null;

    // FK cascades on user_machines / machine_modules drop their rows.
    await tx
      .delete(lmsMachines)
      .where(and(eq(lmsMachines.id, id), tenantWhere(lmsMachines, tid)));
    return t;
  });
  if (!target) throw new Error("Machine not found");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "machine.deleted",
    targetKind: "machine",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/machines");
}
