// Integration tests for the in-app notifications helpers
// (`createNotification` / `createNotifications`). Both helpers are the
// shared insert path for every trigger site (assignment.created,
// assignment.reminder, quiz.completed, whs.expiring, member.joined).
//
// Hits the LIVE local-dev DB. Skipped automatically if DATABASE_URL
// points at the placeholder "test:test@..." default.
//
// What this guards against:
//   - The RLS policy on app.notifications (manual 0009) refusing inserts
//     because the helper forgot to wrap in `forTenant(tid).run` and so
//     `app.tenant_id` was unset.
//   - A future refactor losing best-effort try/catch and bubbling a DB
//     error up through a server action that should keep working.
//   - Bulk insert semantics (single round-trip, no surprise NULLs from
//     the optional body / actionUrl columns).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  forTenant,
  members,
  notifications,
  tenants,
  users,
} from "@tracey/db";
import { createNotification, createNotifications } from "../lib/lms/notifications";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const TENANT_SLUG = "notifications-helper-test";
const OWNER_EMAIL = "notif-owner@example.test";
const RECIPIENT_EMAIL = "notif-recipient@example.test";

interface Seeded {
  tenantId: string;
  ownerId: string;
  recipientId: string;
}

async function ensureUser(email: string, name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ id: randomUUID(), email, name })
    .onConflictDoUpdate({
      target: users.email,
      set: { name },
    })
    .returning({ id: users.id });
  if (!row) throw new Error(`ensureUser(${email}): no row returned`);
  return row.id;
}

async function seed(): Promise<Seeded> {
  const ownerId = await ensureUser(OWNER_EMAIL, "Notif Owner");
  const recipientId = await ensureUser(RECIPIENT_EMAIL, "Notif Recipient");

  const [tenant] = await db
    .insert(tenants)
    .values({
      ownerUserId: ownerId,
      slug: TENANT_SLUG,
      name: "Notifications Helper Test",
      plan: "free",
      status: "trialing",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { updatedAt: drizzleSql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error("seed: tenant upsert returned no row");

  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: ownerId, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  return { tenantId: tenant.id, ownerId, recipientId };
}

async function clearNotifications(tenantId: string): Promise<void> {
  await db.delete(notifications).where(eq(notifications.tenantId, tenantId));
}

async function fullCleanup(seeded: Seeded): Promise<void> {
  await clearNotifications(seeded.tenantId);
  await db.delete(members).where(eq(members.tenantId, seeded.tenantId));
  await db.delete(tenants).where(eq(tenants.id, seeded.tenantId));
  // Leave users behind — other tests may share or own them.
}

describe.skipIf(!isLiveDb)("notification helpers", () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed();
    await clearNotifications(seeded.tenantId);
  }, 30_000);

  afterAll(async () => {
    await fullCleanup(seeded);
  });

  it("createNotification inserts a row scoped to the active tenant", async () => {
    const tdb = forTenant(seeded.tenantId);
    await createNotification(tdb, {
      recipientUserId: seeded.recipientId,
      kind: "test.single",
      title: "Single notification",
      body: "with a body",
      actionUrl: "/somewhere",
    });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "test.single"),
        ),
      );

    expect(rows.length).toBe(1);
    expect(rows[0]?.recipientUserId).toBe(seeded.recipientId);
    expect(rows[0]?.title).toBe("Single notification");
    expect(rows[0]?.body).toBe("with a body");
    expect(rows[0]?.actionUrl).toBe("/somewhere");
    expect(rows[0]?.readAt).toBeNull();
  });

  it("createNotification stores nulls for omitted body / actionUrl", async () => {
    const tdb = forTenant(seeded.tenantId);
    await createNotification(tdb, {
      recipientUserId: seeded.recipientId,
      kind: "test.minimal",
      title: "Minimal notification",
    });

    const [row] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "test.minimal"),
        ),
      );

    expect(row?.body).toBeNull();
    expect(row?.actionUrl).toBeNull();
  });

  it("createNotifications bulk-inserts in one round-trip", async () => {
    const tdb = forTenant(seeded.tenantId);
    await createNotifications(tdb, [
      {
        recipientUserId: seeded.recipientId,
        kind: "test.bulk",
        title: "First",
      },
      {
        recipientUserId: seeded.ownerId,
        kind: "test.bulk",
        title: "Second",
        body: "owner gets a body",
      },
      {
        recipientUserId: seeded.recipientId,
        kind: "test.bulk",
        title: "Third",
        actionUrl: "/three",
      },
    ]);

    const rows = await db
      .select({
        recipientUserId: notifications.recipientUserId,
        title: notifications.title,
        body: notifications.body,
        actionUrl: notifications.actionUrl,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "test.bulk"),
        ),
      );

    expect(rows.length).toBe(3);
    const titles = rows.map((r) => r.title).sort();
    expect(titles).toEqual(["First", "Second", "Third"]);
    const ownerRow = rows.find((r) => r.recipientUserId === seeded.ownerId);
    expect(ownerRow?.body).toBe("owner gets a body");
  });

  it("createNotifications is a no-op on empty input", async () => {
    const tdb = forTenant(seeded.tenantId);
    const before = await db
      .select({ c: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.tenantId, seeded.tenantId));
    await createNotifications(tdb, []);
    const after = await db
      .select({ c: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.tenantId, seeded.tenantId));
    expect(after[0]?.c).toBe(before[0]?.c);
  });

  it("createNotification swallows DB errors (best-effort)", async () => {
    // Recipient UUID does not exist in app.users, so the FK check fails.
    // The helper must catch + log instead of throwing — otherwise a single
    // bad recipient would 500 the user-visible action that triggered it.
    const tdb = forTenant(seeded.tenantId);
    const ghostUuid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await expect(
      createNotification(tdb, {
        recipientUserId: ghostUuid,
        kind: "test.swallowed",
        title: "Should not throw",
      }),
    ).resolves.toBeUndefined();

    // And no row should have been inserted.
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "test.swallowed"),
        ),
      );
    expect(rows.length).toBe(0);
  });
});
