import { test, expect } from "./_setup/auth";
import { db } from "./_setup/db";
import {
  tenants,
  AUDIT_MODE_DEFAULTS,
  type AuditModeSettings,
} from "@tracey/db";
import { eq, sql } from "drizzle-orm";

// Hits the same dev admin as the other specs (E2E_EMAIL/E2E_PASSWORD).
// We flip audit_mode on, walk the gated routes, flip it off, and verify
// audit_events were written. The afterEach always resets audit_mode=false
// so a failing test doesn't leave the dev tenant in Audit Mode.

const HIDDEN_ROUTES = [
  "/app/admin/audit-logs",
  "/app/admin/register",
  "/app/admin/modules/ai-studio",
] as const;

async function findTenantIdByAdminEmail(email: string): Promise<string> {
  const rows = (await db.execute(sql`
    select m.tenant_id as tenant_id
    from app.members m
    join app.users u on u.id = m.user_id
    where lower(u.email) = lower(${email})
    order by m.created_at desc
    limit 1
  `)) as unknown as Array<{ tenant_id: string }>;
  if (!rows[0]) throw new Error(`no tenant for ${email}`);
  return rows[0].tenant_id;
}

async function setAuditMode(
  tenantId: string,
  enabled: boolean,
  overrides: Partial<AuditModeSettings> = {},
): Promise<void> {
  await db
    .update(tenants)
    .set({
      auditMode: enabled,
      // Reset sub-toggles to all-on each time so the master flip behaves
      // the same as the pre-granular state. Tests that want to exercise a
      // specific sub-toggle pass `overrides`.
      auditModeSettings: { ...AUDIT_MODE_DEFAULTS, ...overrides },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

async function latestAuditAction(tenantId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    select action from app.audit_events
    where tenant_id = ${tenantId}
      and action like 'workspace.audit_mode.%'
    order by created_at desc limit 1
  `)) as unknown as Array<{ action: string }>;
  return rows[0]?.action ?? null;
}

test.describe("Audit Mode", () => {
  let tenantId: string;

  test.beforeAll(async () => {
    const email = process.env.E2E_EMAIL;
    if (!email) throw new Error("E2E_EMAIL missing — see global setup");
    tenantId = await findTenantIdByAdminEmail(email);
  });

  test.afterEach(async () => {
    // Always restore so a failure mid-test doesn't strand the dev tenant
    // in Audit Mode. Direct DB write — no UI round-trip.
    await setAuditMode(tenantId, false);
  });

  test("toggle ON via /app/admin/workspace renders amber pill + writes audit event", async ({
    adminPage,
  }) => {
    await setAuditMode(tenantId, false); // known baseline
    await adminPage.goto("/app/admin/workspace", { waitUntil: "domcontentloaded" });

    const checkbox = adminPage.locator('input[name="auditMode"]');
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await adminPage.getByRole("button", { name: /save/i }).click();
    await adminPage.waitForLoadState("networkidle");

    // Stealth indicator: the "a" in the brand logo tints emerald-500. No
    // text label is rendered — an auditor watching the screen sees only
    // a brand colour. We assert on the computed CSS class.
    const accentLetter = adminPage.locator(
      'a[href="/app"] span span',
    ).first();
    await expect(accentLetter).toHaveClass(/text-emerald-500/, {
      timeout: 10_000,
    });
    await expect(
      adminPage.getByText(/Audit Mode — limited view/i),
    ).toHaveCount(0);

    expect(await latestAuditAction(tenantId)).toBe(
      "workspace.audit_mode.enabled",
    );
  });

  test("hidden admin routes return 404 while Audit Mode is on", async ({
    adminPage,
  }) => {
    await setAuditMode(tenantId, true);
    for (const route of HIDDEN_ROUTES) {
      const res = await adminPage.goto(route, { waitUntil: "domcontentloaded" });
      expect(res, `no response for ${route}`).not.toBeNull();
      expect(
        res!.status(),
        `${route} should be 404 while Audit Mode is on, got ${res!.status()}`,
      ).toBe(404);
    }
  });

  test("hidden admin routes are reachable when Audit Mode is off", async ({
    adminPage,
  }) => {
    await setAuditMode(tenantId, false);
    for (const route of HIDDEN_ROUTES) {
      const res = await adminPage.goto(route, { waitUntil: "domcontentloaded" });
      expect(res, `no response for ${route}`).not.toBeNull();
      expect(
        res!.status(),
        `${route} should load while Audit Mode is off, got ${res!.status()}`,
      ).toBeLessThan(400);
    }
  });

  test("workspace settings renders master + all 6 sub-toggle checkboxes", async ({
    adminPage,
  }) => {
    await setAuditMode(tenantId, false);
    await adminPage.goto("/app/admin/workspace", { waitUntil: "domcontentloaded" });
    await expect(adminPage.locator('input[name="auditMode"]')).toBeVisible();
    for (const name of [
      "hideUnpublishedModules",
      "hideIncompleteAssignments",
      "hideFailedAttempts",
      "hideInactiveEmployees",
      "hideExpiredWhs",
      "hideAuditOnlyRoutes",
    ]) {
      await expect(
        adminPage.locator(`input[name="${name}"]`),
        `expected sub-toggle ${name} to render`,
      ).toBeVisible();
    }
  });

  test("hidden routes stay reachable when only hideAuditOnlyRoutes is off, even with master ON", async ({
    adminPage,
  }) => {
    // Master ON, but the route sub-toggle is OFF — other gates (failed
    // attempts etc.) still hide, but the admin can reach Audit logs et al.
    await setAuditMode(tenantId, true, { hideAuditOnlyRoutes: false });
    for (const route of HIDDEN_ROUTES) {
      const res = await adminPage.goto(route, { waitUntil: "domcontentloaded" });
      expect(res, `no response for ${route}`).not.toBeNull();
      expect(
        res!.status(),
        `${route} should be reachable when hideAuditOnlyRoutes=false even with master ON, got ${res!.status()}`,
      ).toBeLessThan(400);
    }
  });

  test("toggling OFF writes a .disabled audit event", async ({ adminPage }) => {
    await setAuditMode(tenantId, true);
    await adminPage.goto("/app/admin/workspace", { waitUntil: "domcontentloaded" });
    const checkbox = adminPage.locator('input[name="auditMode"]');
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await adminPage.getByRole("button", { name: /save/i }).click();
    await adminPage.waitForLoadState("networkidle");

    // Verify the green accent reverts to the brand --primary colour.
    const accentLetter = adminPage.locator(
      'a[href="/app"] span span',
    ).first();
    await expect(accentLetter).not.toHaveClass(/text-emerald-500/, {
      timeout: 10_000,
    });

    expect(await latestAuditAction(tenantId)).toBe(
      "workspace.audit_mode.disabled",
    );
  });
});
