"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { forTenant, lmsAssignments } from "@tracey/db";
import { getAuthorAccess } from "~/lib/auth/author";
import { currentUser } from "~/lib/auth/current";
import { getOrProvisionLmsUser } from "~/lib/lms/learner";
import { tenantWhere } from "~/lib/lms/tenant-scope";
import { logAuditEvent } from "~/lib/audit";

// 365d so the self-assignment never shows up in overdue / WHS reminder paths.
const SELF_ASSIGN_VALIDITY_DAYS = 365;

/**
 * Used by the "Take quiz as me" button on /app/admin/modules/[id]/preview.
 *
 * Admins / owners / qaqc authors don't normally have lms_assignments rows
 * for the modules they author, but the learner quiz page (`requireLearner`
 * + `getAssignmentForLearner`) hard-requires one or returns 404. Mirror
 * Flask: silently create a self-assignment so the author can dogfood the
 * quiz, then redirect into the learner flow. Idempotent — re-clicking
 * just navigates straight through.
 */
export async function selfAssignAndTakeQuizAction(formData: FormData): Promise<void> {
  const access = await getAuthorAccess();
  if (!access) {
    throw new Error("Author access required");
  }
  const user = await currentUser();
  if (!user) throw new Error("Not signed in");

  const moduleId = parseInt(String(formData.get("module_id") ?? ""), 10);
  if (!Number.isFinite(moduleId)) throw new Error("Bad module id");

  const tid = access.traceyTenantId;
  const lmsUser = await getOrProvisionLmsUser({
    traceyUserId: user.id,
    traceyTenantId: tid,
    email: user.email,
    name: user.name,
  });

  const tdb = forTenant(tid);
  const existing = await tdb.run((tx) =>
    tx
      .select({ id: lmsAssignments.id })
      .from(lmsAssignments)
      .where(
        and(
          eq(lmsAssignments.userId, lmsUser.id),
          eq(lmsAssignments.moduleId, moduleId),
          tenantWhere(lmsAssignments, tid),
        ),
      )
      .limit(1),
  );

  if (existing.length === 0) {
    const dueAt = new Date(Date.now() + SELF_ASSIGN_VALIDITY_DAYS * 86_400_000);
    await tdb.run((tx) =>
      tx
        .insert(lmsAssignments)
        .values({
          userId: lmsUser.id,
          moduleId,
          assignedAt: new Date(),
          dueAt,
          traceyTenantId: tid,
        })
        .onConflictDoNothing({
          target: [lmsAssignments.userId, lmsAssignments.moduleId],
        }),
    );

    await logAuditEvent({
      tenantId: tid,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "module.self_assigned",
      targetKind: "module",
      targetId: String(moduleId),
      details: { reason: "take-quiz-as-me", role: access.membershipRole },
    });
  }

  redirect(`/app/my/modules/${moduleId}/quiz`);
}
