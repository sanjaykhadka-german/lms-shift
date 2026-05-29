"use server";

import { redirect } from "next/navigation";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { runAssignmentReminders, runWhsReminders } from "~/lib/lms/reminders";

export async function runAssignmentRemindersAction(): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const sent = await runAssignmentReminders(tid);
  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "reminders.assignments_sent",
    targetKind: "tenant",
    targetId: tid,
    details: { count: sent },
  });
  redirect(`/app/admin?reminders=${sent}`);
}

export async function runWhsRemindersAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const force = formData.get("force") === "1";
  const sent = await runWhsReminders(tid, { force });
  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "reminders.whs_sent",
    targetKind: "tenant",
    targetId: tid,
    details: { count: sent, force },
  });
  redirect(`/app/admin/whs?whs_reminders=${sent}`);
}
