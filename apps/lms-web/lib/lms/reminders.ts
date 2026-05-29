import "server-only";
import { and, eq, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import {
  forTenant,
  lmsAssignments,
  lmsModules,
  lmsUsers,
  lmsWhsRecords,
} from "@tracey/db";
import { tenantWhere } from "./tenant-scope";
import {
  sendAssignmentReminderEmail,
  sendWhsExpiryReminderEmail,
} from "./notify-admin";
import { createNotification } from "./notifications";

// Mirror Flask app.py:3537 (admin_send_reminders) + app.py:391 (process_whs_reminders).
// Both run per-tenant. Returns the count of users emailed.
//
// Each DB call is wrapped in `forTenant(tenantId).run(...)` so `app.tenant_id`
// is set for Postgres RLS (migration 0004). Email I/O happens outside the
// transaction so it doesn't hold row locks.

const WHS_REMINDER_LOOKAHEAD_DAYS = 30;
const WHS_REMINDER_COOLDOWN_DAYS = 14;

const WHS_KIND_SINGULAR: Record<string, string> = {
  high_risk_licence: "High-risk licence",
  fire_warden: "Fire warden",
  first_aider: "First aider",
};

export async function runAssignmentReminders(tenantId: string): Promise<number> {
  const tdb = forTenant(tenantId);
  // Gather every active employee in the tenant who has at least one open
  // assignment, plus the module titles, in one round-trip.
  const rows = await tdb.run((tx) =>
    tx
      .select({
        userId: lmsUsers.id,
        traceyUserId: lmsUsers.traceyUserId,
        email: lmsUsers.email,
        name: lmsUsers.name,
        moduleTitle: lmsModules.title,
      })
      .from(lmsAssignments)
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsAssignments.userId))
      .innerJoin(lmsModules, eq(lmsModules.id, lmsAssignments.moduleId))
      .where(
        and(
          tenantWhere(lmsAssignments, tenantId),
          eq(lmsUsers.isActiveFlag, true),
          eq(lmsUsers.role, "employee"),
          isNull(lmsAssignments.completedAt),
        ),
      )
      .orderBy(lmsUsers.id),
  );

  // Group by user.
  const byUser = new Map<
    number,
    { traceyUserId: string | null; email: string; name: string; titles: string[] }
  >();
  for (const r of rows) {
    const cur = byUser.get(r.userId);
    if (cur) {
      cur.titles.push(r.moduleTitle);
    } else {
      byUser.set(r.userId, {
        traceyUserId: r.traceyUserId,
        email: r.email,
        name: r.name,
        titles: [r.moduleTitle],
      });
    }
  }

  let sent = 0;
  for (const u of byUser.values()) {
    const ok = await sendAssignmentReminderEmail({
      to: u.email,
      name: u.name,
      moduleTitles: u.titles,
    });
    if (ok) sent += 1;
    if (u.traceyUserId) {
      await createNotification(tdb, {
        recipientUserId: u.traceyUserId,
        kind: "assignment.reminder",
        title:
          u.titles.length === 1
            ? `Reminder: complete "${u.titles[0]}"`
            : `Reminder: ${u.titles.length} trainings still open`,
        body: u.titles.length === 1 ? null : u.titles.slice(0, 3).join(", "),
        actionUrl: "/app/my/modules",
      });
    }
  }
  return sent;
}

export async function runWhsReminders(
  tenantId: string,
  opts: { force?: boolean } = {},
): Promise<number> {
  const tdb = forTenant(tenantId);
  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + WHS_REMINDER_LOOKAHEAD_DAYS);
  const cooldownCutoff = new Date(today);
  cooldownCutoff.setDate(cooldownCutoff.getDate() - WHS_REMINDER_COOLDOWN_DAYS);

  const cooldownClause = opts.force
    ? undefined
    : or(
        isNull(lmsWhsRecords.lastRemindedAt),
        lte(lmsWhsRecords.lastRemindedAt, cooldownCutoff),
      );

  const records = await tdb.run((tx) =>
    tx
      .select({
        id: lmsWhsRecords.id,
        kind: lmsWhsRecords.kind,
        title: lmsWhsRecords.title,
        expiresOn: lmsWhsRecords.expiresOn,
        userEmail: lmsUsers.email,
        userName: lmsUsers.name,
        userActive: lmsUsers.isActiveFlag,
        userTraceyId: lmsUsers.traceyUserId,
      })
      .from(lmsWhsRecords)
      .innerJoin(lmsUsers, eq(lmsUsers.id, lmsWhsRecords.userId))
      .where(
        and(
          tenantWhere(lmsWhsRecords, tenantId),
          ne(lmsWhsRecords.kind, "incident"),
          isNotNull(lmsWhsRecords.userId),
          isNotNull(lmsWhsRecords.expiresOn),
          lte(lmsWhsRecords.expiresOn, horizon.toISOString().slice(0, 10)),
          ...(cooldownClause ? [cooldownClause] : []),
        ),
      ),
  );

  let sent = 0;
  for (const r of records) {
    if (!r.userActive) continue;
    const kindLabel = WHS_KIND_SINGULAR[r.kind] ?? "WHS record";
    // Email is best-effort. The in-app notification + lastRemindedAt
    // update fire regardless of email status so a misconfigured Resend
    // can't silence the bell or bust the cooldown into a spam loop.
    const emailOk = await sendWhsExpiryReminderEmail({
      to: r.userEmail,
      name: r.userName,
      kindLabel,
      recordTitle: r.title,
      expiresOn: r.expiresOn,
    });
    if (emailOk) sent += 1;

    // Each update is its own short transaction with `app.tenant_id` set —
    // intentional, so a slow email loop doesn't hold a long-running tx.
    await tdb.run((tx) =>
      tx
        .update(lmsWhsRecords)
        .set({ lastRemindedAt: new Date() })
        .where(eq(lmsWhsRecords.id, r.id)),
    );
    if (r.userTraceyId) {
      await createNotification(tdb, {
        recipientUserId: r.userTraceyId,
        kind: "whs.expiring",
        title: `${kindLabel}: ${r.title} expires ${r.expiresOn ?? "soon"}`,
        body: "Renew before the expiry date to stay compliant.",
        actionUrl: "/app/my/modules",
      });
    }
  }
  return sent;
}

