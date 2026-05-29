"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, tenants, type AuditModeSettings } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";

export interface WorkspaceFormState {
  status: "idle" | "ok" | "error";
  message?: string;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function updateWorkspaceTimezoneAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const tz = String(formData.get("timezone") ?? "").trim();
  if (!tz) {
    return { status: "error", message: "Timezone is required." };
  }
  if (!isValidTimezone(tz)) {
    return { status: "error", message: `'${tz}' is not a recognised IANA timezone.` };
  }

  await db.update(tenants).set({ timezone: tz, updatedAt: new Date() }).where(eq(tenants.id, tid));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "workspace.timezone_updated",
    targetKind: "tenant",
    targetId: tid,
    details: { timezone: tz },
  });

  revalidatePath("/app/admin/workspace");
  revalidatePath("/app", "layout");
  return { status: "ok", message: `Timezone set to ${tz}.` };
}

export async function updateWorkspaceAuditModeAction(
  _prev: WorkspaceFormState,
  formData: FormData,
): Promise<WorkspaceFormState> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;
  const enabled = formData.get("auditMode") === "on";
  const settings: AuditModeSettings = {
    hideUnpublishedModules: formData.get("hideUnpublishedModules") === "on",
    hideIncompleteAssignments:
      formData.get("hideIncompleteAssignments") === "on",
    hideFailedAttempts: formData.get("hideFailedAttempts") === "on",
    hideInactiveEmployees: formData.get("hideInactiveEmployees") === "on",
    hideExpiredWhs: formData.get("hideExpiredWhs") === "on",
    hideAuditOnlyRoutes: formData.get("hideAuditOnlyRoutes") === "on",
  };

  await db
    .update(tenants)
    .set({
      auditMode: enabled,
      auditModeSettings: settings,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tid));

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: enabled
      ? "workspace.audit_mode.enabled"
      : "workspace.audit_mode.disabled",
    targetKind: "tenant",
    targetId: tid,
    details: { settings },
  });

  revalidatePath("/app/admin/workspace");
  revalidatePath("/app", "layout");
  return {
    status: "ok",
    message: enabled
      ? "Audit Mode is now ON with your selected sub-toggles."
      : "Audit Mode is now OFF.",
  };
}
