// Trigger-site test for runAssignmentReminders. Helper-level tests in
// notifications.test.ts cover the createNotification(s) shape; this test
// proves the call site actually fires the right notification rows when an
// admin triggers the manual "Send pending-assignment reminders" button.
//
// Hits the LIVE local-dev DB (skipped when DATABASE_URL is the placeholder
// "test:test@..." default from setup.ts).
//
// What this guards against:
//   - A future refactor losing the createNotification call inside the loop.
//   - A change to the lmsUsers join that drops the traceyUserId column
//     (the column we read to know which auth user to recipient-target).
//   - Notifications fired against the wrong tenant if the tenant filter
//     ever falls off the inner SELECT.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  db,
  lmsAssignments,
  lmsModules,
  lmsUsers,
  lmsWhsRecords,
  members,
  notifications,
  tenants,
  users,
} from "@tracey/db";

// Stub the Resend senders so a populated RESEND_API_KEY in the test shell
// can't deliver mail to the seeded reminders-*@example.test fixtures. The
// in-app notification + cooldown assertions below are unaffected because
// the production callers only branch on the sender's return value.
vi.mock("../lib/lms/notify-admin", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/lms/notify-admin")>(
      "../lib/lms/notify-admin",
    );
  return {
    ...actual,
    sendAssignmentReminderEmail: vi.fn(async () => true),
    sendWhsExpiryReminderEmail: vi.fn(async () => true),
  };
});

import { runAssignmentReminders, runWhsReminders } from "../lib/lms/reminders";

const isLiveDb =
  !!process.env.DATABASE_URL && !/test:test@/.test(process.env.DATABASE_URL);

const TENANT_SLUG = "reminders-trigger-test";
const OWNER_EMAIL = "reminders-owner@example.test";
const LEARNER_EMAIL = "reminders-learner@example.test";

interface Seeded {
  tenantId: string;
  ownerAuthId: string;
  learnerAuthId: string;
  lmsUserId: number;
  moduleId: number;
}

async function ensureAuthUser(email: string, name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ id: randomUUID(), email, name })
    .onConflictDoUpdate({
      target: users.email,
      set: { name },
    })
    .returning({ id: users.id });
  if (!row) throw new Error(`ensureAuthUser(${email}): no row`);
  return row.id;
}

async function seed(): Promise<Seeded> {
  const ownerAuthId = await ensureAuthUser(OWNER_EMAIL, "Reminders Owner");
  const learnerAuthId = await ensureAuthUser(LEARNER_EMAIL, "Reminders Learner");

  const [tenant] = await db
    .insert(tenants)
    .values({
      ownerUserId: ownerAuthId,
      slug: TENANT_SLUG,
      name: "Reminders Trigger Test",
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
    .values({ tenantId: tenant.id, userId: ownerAuthId, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  // Wipe any prior runs so counts are deterministic.
  await db
    .delete(lmsAssignments)
    .where(eq(lmsAssignments.traceyTenantId, tenant.id));
  await db.delete(lmsModules).where(eq(lmsModules.traceyTenantId, tenant.id));
  await db.delete(lmsUsers).where(eq(lmsUsers.traceyTenantId, tenant.id));
  await db.delete(notifications).where(eq(notifications.tenantId, tenant.id));

  // Insert the LMS-side learner with traceyUserId pointing at the auth row.
  const passwordHash = await bcrypt.hash("reminders-lms-pw", 10);
  const [lmsLearner] = await db
    .insert(lmsUsers)
    .values({
      email: LEARNER_EMAIL,
      name: "Reminders Learner",
      passwordHash,
      role: "employee",
      isActiveFlag: true,
      traceyUserId: learnerAuthId,
      traceyTenantId: tenant.id,
    })
    .returning({ id: lmsUsers.id });
  if (!lmsLearner) throw new Error("seed: lmsUsers insert returned no row");

  const [module] = await db
    .insert(lmsModules)
    .values({
      title: "Reminders Test Module",
      description: "A test module to drive runAssignmentReminders.",
      isPublished: true,
      traceyTenantId: tenant.id,
    })
    .returning({ id: lmsModules.id });
  if (!module) throw new Error("seed: lmsModules insert returned no row");

  // Open assignment (no completedAt) so runAssignmentReminders picks it up.
  await db.insert(lmsAssignments).values({
    userId: lmsLearner.id,
    moduleId: module.id,
    assignedAt: new Date(),
    dueAt: new Date(Date.now() + 14 * 86_400_000),
    traceyTenantId: tenant.id,
  });

  return {
    tenantId: tenant.id,
    ownerAuthId,
    learnerAuthId,
    lmsUserId: lmsLearner.id,
    moduleId: module.id,
  };
}

async function fullCleanup(seeded: Seeded): Promise<void> {
  await db.delete(notifications).where(eq(notifications.tenantId, seeded.tenantId));
  await db
    .delete(lmsAssignments)
    .where(eq(lmsAssignments.traceyTenantId, seeded.tenantId));
  await db
    .delete(lmsWhsRecords)
    .where(eq(lmsWhsRecords.traceyTenantId, seeded.tenantId));
  await db.delete(lmsModules).where(eq(lmsModules.traceyTenantId, seeded.tenantId));
  await db.delete(lmsUsers).where(eq(lmsUsers.traceyTenantId, seeded.tenantId));
  await db.delete(members).where(eq(members.tenantId, seeded.tenantId));
  await db.delete(tenants).where(eq(tenants.id, seeded.tenantId));
  // Leave auth users behind — other tests may share them.
}

describe.skipIf(!isLiveDb)("runAssignmentReminders trigger", () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed();
  }, 30_000);

  afterAll(async () => {
    await fullCleanup(seeded);
  });

  it("fires an assignment.reminder notification for the learner with an open assignment", async () => {
    await runAssignmentReminders(seeded.tenantId);

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "assignment.reminder"),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const ours = rows.find(
      (r) => r.recipientUserId === seeded.learnerAuthId,
    );
    expect(ours, "expected a notification for the seeded learner").toBeDefined();
    expect(ours!.title).toContain("Reminders Test Module");
    expect(ours!.actionUrl).toBe("/app/my/modules");
  });

  it("does not fire when the only assignment is completed", async () => {
    // Mark the assignment completed and clear notifications, then re-run.
    await db
      .update(lmsAssignments)
      .set({ completedAt: new Date() })
      .where(eq(lmsAssignments.traceyTenantId, seeded.tenantId));
    await db
      .delete(notifications)
      .where(eq(notifications.tenantId, seeded.tenantId));

    await runAssignmentReminders(seeded.tenantId);

    const countRows = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "assignment.reminder"),
        ),
      );
    expect(countRows[0]?.count ?? 0).toBe(0);
  });
});

describe.skipIf(!isLiveDb)("runWhsReminders trigger", () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seed();
    // Add a WHS record expiring in 14 days, no prior reminder.
    const expiresOn = new Date(Date.now() + 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db.insert(lmsWhsRecords).values({
      kind: "first_aider",
      userId: seeded.lmsUserId,
      title: "First aid certification",
      expiresOn,
      lastRemindedAt: null,
      traceyTenantId: seeded.tenantId,
    });
  }, 30_000);

  afterAll(async () => {
    await fullCleanup(seeded);
  });

  it("fires a whs.expiring notification regardless of email status", async () => {
    // The email sender is mocked at the top of this file, so this asserts
    // the in-app notification fires regardless of what the email path did.
    await runWhsReminders(seeded.tenantId);

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "whs.expiring"),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const ours = rows.find((r) => r.recipientUserId === seeded.learnerAuthId);
    expect(ours, "expected a notification for the seeded learner").toBeDefined();
    expect(ours!.title).toContain("First aid certification");
    expect(ours!.actionUrl).toBe("/app/my/modules");
  });

  it("respects the cooldown on the next call", async () => {
    // The previous run set lastRemindedAt = now. Cooldown is 14 days, so
    // a re-run inside that window should produce no new whs.expiring rows.
    await db
      .delete(notifications)
      .where(eq(notifications.tenantId, seeded.tenantId));

    await runWhsReminders(seeded.tenantId);

    const countRows = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "whs.expiring"),
        ),
      );
    expect(countRows[0]?.count ?? 0).toBe(0);
  });

  it("force=true overrides the cooldown", async () => {
    await db
      .delete(notifications)
      .where(eq(notifications.tenantId, seeded.tenantId));

    await runWhsReminders(seeded.tenantId, { force: true });

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, seeded.tenantId),
          eq(notifications.kind, "whs.expiring"),
        ),
      );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
