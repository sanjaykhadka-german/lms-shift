import "server-only";
import { desc, eq } from "drizzle-orm";
import { auditEvents, db, lmsAuditLogs } from "@tracey/db";
import type { LearnerContext } from "~/lib/lms/learner";

export interface UnifiedAuditRow {
  source: "tracey" | "flask";
  id: string;
  createdAt: Date;
  actorEmail: string | null;
  action: string;
  entity: string;
  summary: string;
}

/**
 * Unified audit log for a tenant: merges Tracey-side app.audit_events
 * (uuid-keyed, explicit tenant filter) with the RLS-covered public.audit_logs
 * (read through ctx.db.run so the app.tenant_id GUC is set). Newest first.
 * Shared by the audit-logs page and its CSV export.
 */
export async function loadAuditLog(
  ctx: LearnerContext,
  perSourceLimit = 200,
  total = 300,
): Promise<UnifiedAuditRow[]> {
  const tid = ctx.traceyTenantId;

  const [tracey, flask] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        createdAt: auditEvents.createdAt,
        actorEmail: auditEvents.actorEmail,
        action: auditEvents.action,
        targetKind: auditEvents.targetKind,
        targetId: auditEvents.targetId,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tid))
      .orderBy(desc(auditEvents.createdAt))
      .limit(perSourceLimit),
    ctx.db.run((tx) =>
      tx
        .select({
          id: lmsAuditLogs.id,
          createdAt: lmsAuditLogs.createdAt,
          actorEmail: lmsAuditLogs.actorEmail,
          action: lmsAuditLogs.action,
          entityType: lmsAuditLogs.entityType,
          entityId: lmsAuditLogs.entityId,
          summary: lmsAuditLogs.summary,
        })
        .from(lmsAuditLogs)
        .where(eq(lmsAuditLogs.traceyTenantId, tid))
        .orderBy(desc(lmsAuditLogs.createdAt))
        .limit(perSourceLimit),
    ),
  ]);

  const unified: UnifiedAuditRow[] = [];
  for (const t of tracey) {
    unified.push({
      source: "tracey",
      id: `tracey-${t.id}`,
      createdAt: t.createdAt ?? new Date(0),
      actorEmail: t.actorEmail ?? null,
      action: t.action,
      entity: [t.targetKind, t.targetId].filter(Boolean).join("#") || "—",
      summary:
        t.details && typeof t.details === "object" ? JSON.stringify(t.details) : "",
    });
  }
  for (const f of flask) {
    unified.push({
      source: "flask",
      id: `flask-${f.id}`,
      createdAt: f.createdAt ?? new Date(0),
      actorEmail: f.actorEmail || null,
      action: f.action,
      entity:
        [f.entityType, f.entityId]
          .filter((x) => x !== null && x !== undefined)
          .join("#") || "—",
      summary: f.summary ?? "",
    });
  }
  unified.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return unified.slice(0, total);
}
