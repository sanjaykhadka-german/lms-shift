"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { lmsAssignments } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { tenantWhere } from "~/lib/lms/tenant-scope";

export async function deleteAssignmentAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const id = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(id)) throw new Error("Bad id");

  await ctx.db.run((tx) =>
    tx
      .delete(lmsAssignments)
      .where(and(eq(lmsAssignments.id, id), tenantWhere(lmsAssignments, tid))),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.unassigned",
    targetKind: "assignment",
    targetId: String(id),
  });
  revalidatePath("/app/admin/assignments");
}
