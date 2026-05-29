import "server-only";
import type { TenantDb } from "@tracey/db";
import { notifications } from "@tracey/db";

/**
 * Insert one in-app notification. Best-effort: a failure here must not block
 * the user-visible action that triggered the notification (assignments,
 * reminders, etc.). Logs and resolves on error.
 *
 * Takes a TenantDb (from `requireAdmin/Learner().db` or `forTenant(tid)`)
 * so the INSERT runs with `app.tenant_id` set — required once
 * 0009_enable_rls_notifications has applied RLS to app.notifications.
 */
export async function createNotification(
  tdb: TenantDb,
  input: {
    recipientUserId: string;
    kind: string;
    title: string;
    body?: string | null;
    actionUrl?: string | null;
  },
): Promise<void> {
  try {
    await tdb.run((tx) =>
      tx.insert(notifications).values({
        tenantId: tdb.tenantId,
        recipientUserId: input.recipientUserId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        actionUrl: input.actionUrl ?? null,
      }),
    );
  } catch (err) {
    console.error("[notifications] failed to insert:", input.kind, err);
  }
}

export async function createNotifications(
  tdb: TenantDb,
  inputs: Array<Parameters<typeof createNotification>[1]>,
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await tdb.run((tx) =>
      tx.insert(notifications).values(
        inputs.map((i) => ({
          tenantId: tdb.tenantId,
          recipientUserId: i.recipientUserId,
          kind: i.kind,
          title: i.title,
          body: i.body ?? null,
          actionUrl: i.actionUrl ?? null,
        })),
      ),
    );
  } catch (err) {
    console.error("[notifications] bulk insert failed:", inputs.length, err);
  }
}
