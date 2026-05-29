"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";
import { auditEvents, db, lmsAuditLogs } from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";

const DEFAULT_DAYS = 365;
const MIN_DAYS = 30;

export async function pruneAuditLogsAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;

  const raw = formData.get("days");
  const parsed = Number(raw);
  const days =
    Number.isFinite(parsed) && parsed >= MIN_DAYS
      ? Math.floor(parsed)
      : DEFAULT_DAYS;

  const cutoff = new Date(Date.now() - days * 86_400_000);

  // app.audit_events â€” Tracey schema, not RLS-covered.
  // allow-cross-tenant: explicit tenantId filter on uuid-keyed Tracey table.
  const traceyDeleted = await db
    .delete(auditEvents)
    .where(
      and(eq(auditEvents.tenantId, tid), lt(auditEvents.createdAt, cutoff)),
    )
    .returning({ id: auditEvents.id });

  // public.audit_logs (legacy LMS) IS RLS-covered (0004_enable_rls.sql).
  // Wrap in ctx.db.run so `app.tenant_id` is set for the policy.
  const flaskDeleted = await ctx.db.run((tx) =>
    tx
      .delete(lmsAuditLogs)
      .where(
        and(
          eq(lmsAuditLogs.traceyTenantId, tid),
          lt(lmsAuditLogs.createdAt, cutoff),
        ),
      )
      .returning({ id: lmsAuditLogs.id }),
  );

  // Audit-log the prune itself so we have a record of who pruned what,
  // even though every prior row at that range is now gone.
  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "audit.pruned",
    targetKind: "tenant",
    targetId: tid,
    details: {
      days,
      cutoff: cutoff.toISOString(),
      traceyDeleted: traceyDeleted.length,
      flaskDeleted: flaskDeleted.length,
    },
  });

  revalidatePath("/app/admin/audit-logs");
  redirect(
    `/app/admin/audit-logs?pruned=${traceyDeleted.length + flaskDeleted.length}&days=${days}`,
  );
}
