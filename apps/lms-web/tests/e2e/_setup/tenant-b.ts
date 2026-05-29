// Idempotent seed for two synthetic test tenants ("Tenant A" and
// "Tenant B"), used by the cross-tenant isolation spec. Both tenants are
// owned by separate users and have separate `lms_users` rows; the spec
// signs in as each one in turn and proves data does not leak across.
//
// Why synthetic both tenants instead of reusing the E2E_EMAIL admin?
//  - Removes dependency on .env.test.local for this spec — the isolation
//    test is the most important regression net for Phase 6/7 and should
//    just work after `pnpm install`.
//  - Keeps the spec hermetic: it doesn't touch the GB tenant or any
//    real-looking admin data.
//
// Re-running the spec must not duplicate rows or invalidate prior
// credentials, so all writes are upserts keyed on natural unique columns
// (users.email, tenants.slug, members.tenantId+userId).
//
// Local-only: this code touches the dev DB directly and is never imported
// from a production code path.

import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, forTenant, lmsModules, lmsUsers, members, tenants, users } from "@tracey/db";

export interface TestTenant {
  tenantId: string;
  userId: string;
  email: string;
  password: string;
}

interface SeedSpec {
  email: string;
  password: string;
  slug: string;
  tenantName: string;
  userName: string;
}

const TENANT_A: SeedSpec = {
  email: process.env.E2E_TENANT_A_EMAIL ?? "tenant-a-admin@example.test",
  password: process.env.E2E_TENANT_A_PASSWORD ?? "tenant-a-pass-1",
  slug: process.env.E2E_TENANT_A_SLUG ?? "tenant-a-isolation-test",
  tenantName: process.env.E2E_TENANT_A_NAME ?? "Tenant A (isolation test)",
  userName: "Tenant A Admin",
};

const TENANT_B: SeedSpec = {
  email: process.env.E2E_TENANT_B_EMAIL ?? "tenant-b-admin@example.test",
  password: process.env.E2E_TENANT_B_PASSWORD ?? "tenant-b-pass-1",
  slug: process.env.E2E_TENANT_B_SLUG ?? "tenant-b-isolation-test",
  tenantName: process.env.E2E_TENANT_B_NAME ?? "Tenant B (isolation test)",
  userName: "Tenant B Admin",
};

const TENANT_C: SeedSpec = {
  // Phase 7b — provisioned tenant for the mixed-isolation-models test.
  // ensureTenantC additionally calls provisionTenant() on the seeded
  // tenant so its LMS queries route through tenant_<c>.* via search_path.
  email: process.env.E2E_TENANT_C_EMAIL ?? "tenant-c-admin@example.test",
  password: process.env.E2E_TENANT_C_PASSWORD ?? "tenant-c-pass-1",
  slug: process.env.E2E_TENANT_C_SLUG ?? "tenant-c-isolation-test",
  tenantName: process.env.E2E_TENANT_C_NAME ?? "Tenant C (provisioned isolation test)",
  userName: "Tenant C Admin",
};

async function ensureTenant(spec: SeedSpec): Promise<TestTenant> {
  // 1. Upsert app.users by email. id mirrors the Supabase auth user id; for
  //    seed-only tenants we mint a uuid (no Supabase auth user is created).
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: spec.email,
      name: spec.userName,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: spec.userName },
    })
    .returning({ id: users.id });
  if (!user) throw new Error(`ensureTenant(${spec.slug}): failed to upsert app.users row`);

  // 2. Upsert app.tenants by slug. Owner is the user we just made/found.
  const [tenant] = await db
    .insert(tenants)
    .values({
      ownerUserId: user.id,
      slug: spec.slug,
      name: spec.tenantName,
      plan: "free",
      status: "trialing",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { name: spec.tenantName, updatedAt: sql`now()` },
    })
    .returning({ id: tenants.id });
  if (!tenant) throw new Error(`ensureTenant(${spec.slug}): failed to upsert app.tenants row`);

  // 3. Upsert app.members by (tenantId, userId). Role: owner so the test
  //    user can hit /app/admin/* routes the same way a real owner does.
  await db
    .insert(members)
    .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [members.tenantId, members.userId],
      set: { role: "owner" },
    });

  // 4. Upsert the matching legacy lms_users row. requireAdmin() calls
  //    getOrProvisionLmsUser() which would auto-provision this on first
  //    sign-in, but pre-creating it keeps the first test run deterministic.
  const lmsHash = await bcrypt.hash(spec.password, 10);
  await db
    .insert(lmsUsers)
    .values({
      email: spec.email,
      name: spec.userName,
      firstName: spec.userName.split(" ")[0] ?? spec.userName,
      lastName: spec.userName.split(" ").slice(1).join(" "),
      passwordHash: lmsHash,
      role: "owner",
      isActiveFlag: true,
      traceyUserId: user.id,
      traceyTenantId: tenant.id,
    })
    .onConflictDoUpdate({
      target: lmsUsers.email,
      set: {
        traceyUserId: user.id,
        traceyTenantId: tenant.id,
        isActiveFlag: true,
        role: "owner",
      },
    });

  return {
    tenantId: tenant.id,
    userId: user.id,
    email: spec.email,
    password: spec.password,
  };
}

export async function ensureTenantA(): Promise<TestTenant> {
  return ensureTenant(TENANT_A);
}

export async function ensureTenantB(): Promise<TestTenant> {
  return ensureTenant(TENANT_B);
}

/** Row-per-tenant: there is no per-tenant schema to provision, so this is
 *  just another seeded tenant (kept as a distinct name for the isolation
 *  spec that references Tenant C). */
export async function ensureTenantC(): Promise<TestTenant> {
  return ensureTenant(TENANT_C);
}

export async function deleteModulesByTitle(title: string): Promise<number> {
  // Cleanup helper: removes any probe rows that the spec leaked. Safe to
  // call repeatedly. Filters by title so we never touch unrelated data.
  const rows = await db
    .delete(lmsModules)
    .where(eq(lmsModules.title, title))
    .returning({ id: lmsModules.id });
  return rows.length;
}

export async function createProbeModule(opts: {
  tenantId: string;
  title: string;
}): Promise<number> {
  // Insert a module owned by `tenantId`. Bypasses the admin UI form on
  // purpose — the isolation test cares about cross-tenant reads, not the
  // create flow. Returns the new module's numeric ID.
  const [row] = await db
    .insert(lmsModules)
    .values({
      title: opts.title,
      isPublished: false,
      traceyTenantId: opts.tenantId,
    })
    .returning({ id: lmsModules.id });
  if (!row) throw new Error("createProbeModule: insert returned no row");
  return row.id;
}

/** Like createProbeModule, but writes via forTenant() so the row lands in
 *  the tenant's per-tenant schema (when one exists) rather than public.
 *  Use for tenants that have been provisioned via provisionTenant(). */
export async function createProbeModuleInTenantSchema(opts: {
  tenantId: string;
  title: string;
}): Promise<number> {
  return forTenant(opts.tenantId).run(async (tx) => {
    const [row] = await tx
      .insert(lmsModules)
      .values({
        title: opts.title,
        isPublished: false,
        traceyTenantId: opts.tenantId,
      })
      .returning({ id: lmsModules.id });
    if (!row) throw new Error("createProbeModuleInTenantSchema: insert returned no row");
    return row.id;
  });
}
