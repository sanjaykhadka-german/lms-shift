import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

// Imported after env is loaded (client.ts reads DATABASE_URL at import time).
const { db, forTenant, users, tenants, members, lmsModules } = await import(
  "./index"
);

/**
 * Seeds two demo tenants and verifies row-per-tenant isolation end to end:
 *   1. app.users / app.tenants / app.members rows (RLS-excluded) inserted directly.
 *   2. A demo lms_modules row per tenant, inserted through forTenant() so the
 *      app.tenant_id GUC is set and RLS (FORCE) admits the write.
 *   3. Asserts forTenant(A) sees only A's module, forTenant(B) only B's, and a
 *      query OUTSIDE forTenant() (no GUC) sees ZERO rows (fail-closed).
 *
 * Needs only DATABASE_URL — no Supabase Auth. The seeded user ids are random
 * uuids (no real auth.users rows), so these accounts can't log in; they exist
 * to exercise the data layer + RLS. Sign up through the UI for a real login.
 */
async function seedTenant(label: string, slug: string) {
  const userId = randomUUID();
  const email = `${slug}-owner@example.com`;

  await db
    .insert(users)
    .values({ id: userId, email, name: `${label} Owner` })
    .onConflictDoUpdate({ target: users.email, set: { name: `${label} Owner` } });

  // Re-fetch in case the email already existed under a different id.
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const ownerId = u!.id;

  const [tenant] = await db
    .insert(tenants)
    .values({ ownerUserId: ownerId, name: label, slug })
    .onConflictDoUpdate({ target: tenants.slug, set: { name: label } })
    .returning();

  await db
    .insert(members)
    .values({ tenantId: tenant!.id, userId: ownerId, role: "owner" })
    .onConflictDoNothing({ target: [members.tenantId, members.userId] });

  // Demo module via the tenant-scoped path (RLS-enforced write).
  await forTenant(tenant!.id).run((tx) =>
    tx
      .insert(lmsModules)
      .values({
        title: `${label} — Welcome module`,
        traceyTenantId: tenant!.id,
        isPublished: true,
      }),
  );

  return { tenantId: tenant!.id, ownerId, email };
}

async function main() {
  const a = await seedTenant("Demo Tenant A", "demo-tenant-a");
  const b = await seedTenant("Demo Tenant B", "demo-tenant-b");
  console.log(`[seed] tenant A = ${a.tenantId} (${a.email})`);
  console.log(`[seed] tenant B = ${b.tenantId} (${b.email})`);

  // ── Isolation checks ──────────────────────────────────────────────────
  const aRows = await forTenant(a.tenantId).run((tx) => tx.select().from(lmsModules));
  const bRows = await forTenant(b.tenantId).run((tx) => tx.select().from(lmsModules));
  const leak = await db.select().from(lmsModules); // no GUC → RLS should return 0

  const aOnlyA = aRows.every((r) => r.traceyTenantId === a.tenantId);
  const bOnlyB = bRows.every((r) => r.traceyTenantId === b.tenantId);

  console.log(`[seed] forTenant(A) modules: ${aRows.length} (all A: ${aOnlyA})`);
  console.log(`[seed] forTenant(B) modules: ${bRows.length} (all B: ${bOnlyB})`);
  console.log(`[seed] no-GUC query modules: ${leak.length} (expected 0 — fail-closed)`);

  if (!aOnlyA || !bOnlyB || leak.length !== 0) {
    console.error("[seed] ❌ RLS isolation check FAILED");
    process.exit(1);
  }
  console.log("[seed] ✅ row-per-tenant isolation verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
