"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { lmsAssignments, lmsModules, lmsUsers } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { formatDate } from "~/lib/format/datetime";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { createNotifications } from "~/lib/lms/notifications";

const DEFAULT_VALIDITY_DAYS = 180;

export async function bulkAssignModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");

  const [module] = await ctx.db.run((tx) =>
    tx
      .select()
      .from(lmsModules)
      .where(and(eq(lmsModules.id, moduleId), tenantWhere(lmsModules, tid)))
      .limit(1),
  );
  if (!module) throw new Error("Module not found");

  const userIds = formData
    .getAll("user_ids")
    .map(String)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => parseInt(s, 10));
  if (userIds.length === 0) {
    redirect(`/app/admin/modules/${moduleId}/assign?info=nochosen`);
  }

  const days = module.validForDays ?? DEFAULT_VALIDITY_DAYS;
  const now = new Date();
  const dueAt = days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Bulk insert with ON CONFLICT DO NOTHING so existing (user, module) pairs
  // are skipped silently.
  const inserted = await ctx.db.run((tx) =>
    tx
      .insert(lmsAssignments)
      .values(
        userIds.map((userId) => ({
          userId,
          moduleId,
          assignedAt: now,
          dueAt,
          traceyTenantId: tid,
        })),
      )
      .onConflictDoNothing({ target: [lmsAssignments.userId, lmsAssignments.moduleId] })
      .returning({ id: lmsAssignments.id, userId: lmsAssignments.userId }),
  );

  if (inserted.length > 0) {
    const recipients = await ctx.db.run((tx) =>
      tx
        .select({ id: lmsUsers.id, traceyUserId: lmsUsers.traceyUserId })
        .from(lmsUsers)
        .where(
          and(
            tenantWhere(lmsUsers, tid),
            inArray(
              lmsUsers.id,
              inserted.map((r) => r.userId),
            ),
          ),
        ),
    );
    const dueLine = dueAt ? `Due ${formatDate(dueAt, ctx.tenantTimezone)}` : null;
    await createNotifications(
      ctx.db,
      recipients
        .filter((r): r is { id: number; traceyUserId: string } => Boolean(r.traceyUserId))
        .map((r) => ({
          recipientUserId: r.traceyUserId,
          kind: "assignment.created",
          title: `New training: ${module.title}`,
          body: dueLine,
          actionUrl: "/app/my/modules",
        })),
    );
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.bulk_assigned",
    targetKind: "module",
    targetId: String(moduleId),
    details: { requested: userIds.length, created: inserted.length },
  });
  revalidatePath(`/app/admin/modules/${moduleId}/assign`);
  redirect(
    `/app/admin/modules/${moduleId}/assign?ok=1&created=${inserted.length}&requested=${userIds.length}`,
  );
}

export async function unassignModuleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  const assignmentId = parseInt(String(formData.get("id") ?? ""), 10);
  if (!Number.isFinite(moduleId) || !Number.isFinite(assignmentId)) throw new Error("Bad id");

  await ctx.db.run((tx) =>
    tx
      .delete(lmsAssignments)
      .where(
        and(
          eq(lmsAssignments.id, assignmentId),
          eq(lmsAssignments.moduleId, moduleId),
          tenantWhere(lmsAssignments, tid),
        ),
      ),
  );

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "module.unassigned",
    targetKind: "assignment",
    targetId: String(assignmentId),
    details: { moduleId },
  });
  revalidatePath(`/app/admin/modules/${moduleId}/assign`);
}
