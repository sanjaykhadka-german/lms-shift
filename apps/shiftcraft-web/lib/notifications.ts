import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, forTenant, members, notifications } from "@tracey/db";
import { sendPushToUser } from "./web-push";

// In-app notification writer for ShiftCraft. Mirrors the lms-web helper shape
// (apps/lms-web/lib/lms/notifications.ts) so the row format stays consistent
// across apps — the same `app.notifications` table is read by the bell
// dropdown regardless of which app wrote the row.
//
// Best-effort: failure here must not block the user-visible action that
// triggered the notification. Logs and resolves on error.

export interface NotificationInput {
  recipientUserId: string;
  kind: string;
  title: string;
  body?: string | null;
  actionUrl?: string | null;
}

export async function createNotifications(
  tenantId: string,
  inputs: NotificationInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await forTenant(tenantId).run((tx) =>
      tx.insert(notifications).values(
        inputs.map((i) => ({
          tenantId,
          recipientUserId: i.recipientUserId,
          kind: i.kind,
          title: i.title,
          body: i.body ?? null,
          actionUrl: i.actionUrl ?? null,
        })),
      ),
    );
  } catch (err) {
    console.error("[shiftcraft/notifications] insert failed:", inputs.length, err);
    // In-app fan-out failed — don't try to push either (the user
    // would see a push without a corresponding bell entry).
    return;
  }

  // AUDIT.md #12 — best-effort web push for the same recipients.
  // sendPushToUser swallows individual failures and silently returns
  // zeros when VAPID isn't configured. Run after the insert commit
  // so an out-of-band push can't precede the in-app notification.
  await Promise.allSettled(
    inputs.map((i) =>
      sendPushToUser(tenantId, i.recipientUserId, {
        title: i.title,
        body: i.body ?? undefined,
        actionUrl: i.actionUrl ?? undefined,
        tag: i.kind,
      }),
    ),
  );
}

// Fan-out helper: write one notification to every owner/admin in the tenant.
// Used when an event (e.g. a new ShiftCraft employee) should land in every
// admin's bell dropdown so whichever admin is online next can act on it.
export async function notifyTenantAdmins(
  tenantId: string,
  input: Omit<NotificationInput, "recipientUserId">,
  options?: { excludeUserId?: string },
): Promise<void> {
  const admins = await db
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(
        eq(members.tenantId, tenantId),
        inArray(members.role, ["owner", "admin"]),
      ),
    );
  const recipients = admins
    .map((a) => a.userId)
    .filter((id) => id !== options?.excludeUserId);
  if (recipients.length === 0) return;
  await createNotifications(
    tenantId,
    recipients.map((recipientUserId) => ({ ...input, recipientUserId })),
  );
}
