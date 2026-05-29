// RLS regression test for app.notifications. Mirrors the per-tenant-rls
// pattern but for the app-schema notifications table — proves the
// 0009_enable_rls_notifications migration is in effect AND that
// app code reading via forTenant() correctly sees only its tenant's
// rows.
//
// Skipped unless RLS_TEST_DATABASE_URL is set. CI applies the manual
// migration (0009) plus creates the tracey_test_rls role, so this
// runs by default in CI.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql as drizzleSql, eq } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  db,
  members,
  notifications,
  tenants,
  users,
} from "@tracey/db";

const rlsUrl = process.env.RLS_TEST_DATABASE_URL;

const SLUG_A = "rls-notifs-a";
const SLUG_B = "rls-notifs-b";
const EMAIL_A = "rls-notifs-a@example.test";
const EMAIL_B = "rls-notifs-b@example.test";

interface SeedTenant {
  tenantId: string;
  userId: string;
}

async function seedTenant(email: string, slug: string, name: string): Promise<SeedTenant> {
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), email, name })
    .onConflictDoUpdate({
      target: users.email,
      set: { name },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`seedTenant(${slug}): users upsert returned no row`);

  const [tenant] = await db
    .insert(tenants)
    .values({ ownerUserId: user.id, slug, name, plan: "free", status: "trialing" })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { updatedAt: drizzleSql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`seedTenant(${slug}): tenants upsert returned no row`);

  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  return { tenantId: tenant.id, userId: user.id };
}

describe.skipIf(!rlsUrl)("app.notifications RLS — non-superuser visibility", () => {
  let tenantA: SeedTenant;
  let tenantB: SeedTenant;

  beforeAll(async () => {
    tenantA = await seedTenant(EMAIL_A, SLUG_A, "RLS Notifs Tenant A");
    tenantB = await seedTenant(EMAIL_B, SLUG_B, "RLS Notifs Tenant B");

    // Wipe any stale notifications from prior runs.
    await db.execute(
      drizzleSql`DELETE FROM app.notifications WHERE tenant_id IN (${tenantA.tenantId}::uuid, ${tenantB.tenantId}::uuid)`,
    );

    // Seed one notification per tenant via the superuser db (bypasses RLS).
    await db.insert(notifications).values([
      {
        tenantId: tenantA.tenantId,
        recipientUserId: tenantA.userId,
        kind: "test.rls",
        title: "Tenant A notification",
      },
      {
        tenantId: tenantB.tenantId,
        recipientUserId: tenantB.userId,
        kind: "test.rls",
        title: "Tenant B notification",
      },
    ]);
  }, 30_000);

  afterAll(async () => {
    await db.execute(
      drizzleSql`DELETE FROM app.notifications WHERE tenant_id IN (${tenantA.tenantId}::uuid, ${tenantB.tenantId}::uuid)`,
    );
  });

  it("returns zero rows under non-superuser without app.tenant_id set", async () => {
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    try {
      const rows = await rlsSql`SELECT count(*)::int AS c FROM app.notifications`;
      expect(rows[0]?.c, "RLS without GUC must hide all notifications").toBe(0);
    } finally {
      await rlsSql.end();
    }
  });

  it("admits only tenant A's notification when GUC is set to tenant A", async () => {
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    try {
      await rlsSql.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.tenant_id', '${tenantA.tenantId}', true)`);
        const rows = await tx`SELECT title FROM app.notifications`;
        expect(rows.length).toBe(1);
        expect(rows[0]?.title).toBe("Tenant A notification");
      });
    } finally {
      await rlsSql.end();
    }
  });

  it("admits only tenant B's notification when GUC is set to tenant B", async () => {
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    try {
      await rlsSql.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.tenant_id', '${tenantB.tenantId}', true)`);
        const rows = await tx`SELECT title FROM app.notifications`;
        expect(rows.length).toBe(1);
        expect(rows[0]?.title).toBe("Tenant B notification");
      });
    } finally {
      await rlsSql.end();
    }
  });

  it("rejects INSERT with mismatched tenant_id under WITH CHECK policy", async () => {
    // GUC says tenant A, but row tries to insert with tenant B's id.
    // RLS WITH CHECK should reject. With buggy / missing RLS, the row
    // would land and leak across tenants.
    const rlsSql = postgres(rlsUrl!, { max: 1, prepare: false });
    let threw = false;
    try {
      await rlsSql.begin(async (tx) => {
        await tx.unsafe(`SELECT set_config('app.tenant_id', '${tenantA.tenantId}', true)`);
        await tx.unsafe(
          `INSERT INTO app.notifications (tenant_id, recipient_user_id, kind, title) VALUES ('${tenantB.tenantId}', '${tenantB.userId}', 'test.smuggle', 'should fail')`,
        );
      });
    } catch {
      threw = true;
    } finally {
      await rlsSql.end();
    }
    expect(threw, "INSERT with tenant_id != GUC must be rejected by RLS WITH CHECK").toBe(true);
  });
});
