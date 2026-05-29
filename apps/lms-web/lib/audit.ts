import "server-only";
import { db, auditEvents } from "@tracey/db";

/**
 * Append a row to app.audit_events. Best-effort: if the insert fails the
 * helper logs and resolves — never block the user-visible action that
 * triggered the audit. Surfaces in the platform-admin UI.
 */
export async function logAuditEvent(opts: {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetKind?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      tenantId: opts.tenantId ?? null,
      actorUserId: opts.actorUserId ?? null,
      actorEmail: opts.actorEmail ?? null,
      action: opts.action,
      targetKind: opts.targetKind ?? null,
      targetId: opts.targetId ?? null,
      details: opts.details ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to write event:", opts.action, err);
  }
}
