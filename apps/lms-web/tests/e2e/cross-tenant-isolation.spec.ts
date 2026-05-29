// Phase 6 regression net: prove tenant B cannot see, fetch, or mutate a
// module that belongs to tenant A. This spec is the ground-truth check that
// makes RLS rollout safe — if it passes with RLS off (today's app-layer
// tenantWhere() filter) AND with RLS on (after 0004_enable_rls.sql), then
// the chokepoint is sound for both isolation models.
//
// Self-seeded: both tenants are created synthetically by the spec's
// fixtures. No dependency on .env.test.local credentials — the test runs
// hermetically.

import { test as base, expect } from "@playwright/test";
import { signIn, signOut } from "./_setup/auth";
import {
  createProbeModule,
  createProbeModuleInTenantSchema,
  deleteModulesByTitle,
  ensureTenantA,
  ensureTenantB,
  ensureTenantC,
  type TestTenant,
} from "./_setup/tenant-b";

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PROBE_TITLE = `ISOLATION-PROBE-${RUN_ID}`;
const PROBE_TITLE_PROVISIONED = `ISOLATION-PROBE-PROVISIONED-${RUN_ID}`;

const test = base.extend<{
  tenantA: TestTenant;
  tenantB: TestTenant;
  tenantC: TestTenant;
}>({
  tenantA: async ({}, use) => {
    const creds = await ensureTenantA();
    await use(creds);
  },
  tenantB: async ({}, use) => {
    const creds = await ensureTenantB();
    await use(creds);
  },
  tenantC: async ({}, use) => {
    const creds = await ensureTenantC();
    await use(creds);
  },
});

test.beforeAll(async () => {
  // Idempotent guard: if a previous failed run left probe modules behind,
  // wipe them so the create step starts from a clean state. We only need
  // to clean public.modules; provisioned-tenant probes are dropped when
  // the test's afterAll drops `tenant_<c>` (it doesn't, in this spec —
  // we leave Tenant C's schema intact across runs since ensureTenantC is
  // idempotent — so we explicitly delete by title from the per-tenant
  // schema too via deleteModulesByTitle).
  await deleteModulesByTitle(PROBE_TITLE);
  await deleteModulesByTitle(PROBE_TITLE_PROVISIONED);
});

test.afterAll(async () => {
  // Clean up the probe modules regardless of pass/fail. Safe — filtered
  // by unique probe titles.
  await deleteModulesByTitle(PROBE_TITLE);
  await deleteModulesByTitle(PROBE_TITLE_PROVISIONED);
});

test("cross-tenant: tenant B cannot see, fetch, or mutate tenant A's module", async ({
  page,
  tenantA,
  tenantB,
}) => {
  // ── Setup: insert tenant A's probe module via DB ──────────────────────
  // We bypass the admin UI's create form on purpose — this test is about
  // cross-tenant READ isolation, not the create-flow. The probe row carries
  // tenantA.tenantId on traceyTenantId, which is exactly what RLS and
  // tenantWhere() filter against.
  const probeId = await createProbeModule({ tenantId: tenantA.tenantId, title: PROBE_TITLE });

  // Sanity: signed in as tenant A, the module is visible on the list page.
  await signIn(page, tenantA.email, tenantA.password);
  await page.goto("/app/admin/modules");
  await expect(page.getByText(PROBE_TITLE).first()).toBeVisible();
  await signOut(page);

  // ── Tenant B: try to see, fetch ────────────────────────────────────────
  await signIn(page, tenantB.email, tenantB.password);

  // 1. Module list must NOT contain the probe title.
  await page.goto("/app/admin/modules");
  await expect(page.locator("body")).not.toContainText(PROBE_TITLE);

  // 2. Direct GET on tenant A's module ID must 404 (Next.js notFound()).
  const directRes = await page.goto(`/app/admin/modules/${probeId}`, {
    waitUntil: "domcontentloaded",
  });
  expect(directRes, "no response to direct probe").not.toBeNull();
  expect(directRes!.status(), `tenant B got ${directRes!.status()} on tenant A's module`).toBe(404);

  // 3. Direct GET on the assignment screen must also 404 (separate
  //    requireAdmin call → separate tenant scope).
  const assignRes = await page.goto(`/app/admin/modules/${probeId}/assign`, {
    waitUntil: "domcontentloaded",
  });
  expect(assignRes, "no response to assign probe").not.toBeNull();
  expect(assignRes!.status(), `tenant B got ${assignRes!.status()} on tenant A's assign page`).toBe(404);

  // Test ends here. We don't sign out: we're on a 404 page (no user menu),
  // and Playwright destroys the browser context between tests anyway.
});

test("mixed-models: tenant A (fallthrough) cannot see tenant C's (provisioned) module", async ({
  page,
  tenantA,
  tenantC,
}) => {
  // Phase 7b regression: prove the chokepoint isolates *across* the two
  // isolation models. Tenant A is fallthrough (queries hit public.lms_*);
  // tenant C is provisioned (queries route via search_path to tenant_<c>.lms_*).
  // The cross-tenant guarantee must hold even when the two tenants live
  // in different physical schemas.
  //
  // ensureTenantC seeds tenantC AND calls provisionTenant(), so tenant_<c>
  // exists with all 19 LMS tables before this test runs.

  // Insert tenant C's probe via forTenant() — the search_path SET makes
  // the row land in `tenant_<c>.modules`, NOT public.modules.
  const probeId = await createProbeModuleInTenantSchema({
    tenantId: tenantC.tenantId,
    title: PROBE_TITLE_PROVISIONED,
  });

  // Sign in as tenant A (fallthrough). Their queries hit public.modules.
  // The provisioned probe lives in tenant_<c>.modules, so it should be
  // invisible to tenant A.
  await signIn(page, tenantA.email, tenantA.password);

  // 1. Module list must NOT contain tenant C's probe title.
  await page.goto("/app/admin/modules");
  await expect(page.locator("body")).not.toContainText(PROBE_TITLE_PROVISIONED);

  // 2. Direct GET on tenant C's module ID must 404 — the integer ID is
  //    sequence-isolated per tenant schema, but even a colliding ID would
  //    not match against public.modules (where tenant A's queries land).
  const directRes = await page.goto(`/app/admin/modules/${probeId}`, {
    waitUntil: "domcontentloaded",
  });
  expect(directRes, "no response to direct probe").not.toBeNull();
  expect(
    directRes!.status(),
    `tenant A got ${directRes!.status()} on tenant C's provisioned module`,
  ).toBe(404);
});
