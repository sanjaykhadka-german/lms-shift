"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lmsPositions, lmsUsers } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import type { FormState } from "../_components/NameCrudForm";

const baseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
});

function parseOptionalInt(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

export async function createPositionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const parsed = baseSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const name = parsed.data.name;
  const parentId = parseOptionalInt(formData.get("parent_id"));
  const departmentId = parseOptionalInt(formData.get("department_id"));

  const [row] = await ctx.db.run((tx) =>
    tx
      .insert(lmsPositions)
      .values({ name, parentId, departmentId, traceyTenantId: tid })
      .returning({ id: lmsPositions.id }),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.created",
    targetKind: "position",
    targetId: String(row?.id ?? ""),
    details: { name, parentId, departmentId },
  });
  revalidatePath("/app/admin/positions");
  return { status: "ok", message: `Position '${name}' added.` };
}

export async function updatePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseOptionalInt(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const parsed = baseSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    redirect(`/app/admin/positions/${id}/edit?error=name`);
  }
  const name = parsed.data.name;
  let parentId = parseOptionalInt(formData.get("parent_id"));
  const departmentId = parseOptionalInt(formData.get("department_id"));

  await ctx.db.run(async (tx) => {
    const [current] = await tx
      .select()
      .from(lmsPositions)
      .where(and(eq(lmsPositions.id, id), tenantWhere(lmsPositions, tid)))
      .limit(1);
    if (!current) throw new Error("Position not found");

    // Cycle guard â€” port of app.py:1582-1593. Self-as-parent and direct-child
    // -as-parent only; deeper cycles are unlikely in practice.
    if (parentId === id) {
      parentId = current.parentId;
    } else if (parentId !== null) {
      const [candidate] = await tx
        .select({ parentId: lmsPositions.parentId })
        .from(lmsPositions)
        .where(and(eq(lmsPositions.id, parentId), tenantWhere(lmsPositions, tid)))
        .limit(1);
      if (candidate?.parentId === id) {
        parentId = current.parentId;
      }
    }

    await tx
      .update(lmsPositions)
      .set({ name, parentId, departmentId })
      .where(and(eq(lmsPositions.id, id), tenantWhere(lmsPositions, tid)));
  });

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.updated",
    targetKind: "position",
    targetId: String(id),
    details: { name, parentId, departmentId },
  });
  revalidatePath("/app/admin/positions");
  redirect("/app/admin/positions");
}

export async function deletePositionAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseOptionalInt(formData.get("id"));
  if (!id) throw new Error("Bad id");

  const target = await ctx.db.run(async (tx) => {
    const [t] = await tx
      .select()
      .from(lmsPositions)
      .where(and(eq(lmsPositions.id, id), tenantWhere(lmsPositions, tid)))
      .limit(1);
    if (!t) return null;

    // Reparent children to this position's parent so they don't orphan
    // (matches Flask app.py:1613-1614).
    await tx
      .update(lmsPositions)
      .set({ parentId: t.parentId })
      .where(and(eq(lmsPositions.parentId, id), tenantWhere(lmsPositions, tid)));
    // Users hold this position via FK; clearing position_id is the visible
    // effect the audit message describes.
    await tx
      .update(lmsUsers)
      .set({ positionId: null })
      .where(and(eq(lmsUsers.positionId, id), eq(lmsUsers.traceyTenantId, tid)));
    await tx
      .delete(lmsPositions)
      .where(and(eq(lmsPositions.id, id), tenantWhere(lmsPositions, tid)));
    return t;
  });
  if (!target) throw new Error("Position not found");

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.deleted",
    targetKind: "position",
    targetId: String(id),
    details: { name: target.name },
  });
  revalidatePath("/app/admin/positions");
}
