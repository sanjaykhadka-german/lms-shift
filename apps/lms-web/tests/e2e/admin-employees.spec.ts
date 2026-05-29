import { test, expect } from "./_setup/auth";
import { deleteLmsUserByEmail } from "./_setup/db";

// Create an employee through the admin UI; verify the new row appears in
// the list. Direct DB cleanup in afterAll keeps the tenant uncluttered.

const EMAIL = `e2etest-${Date.now()}@example.com`;
const FIRST = "E2E";
const LAST = "Test";
const PHONE = "+61 400000000";

test.afterAll(async () => {
  // Best-effort cleanup. If the spec failed before insert, this is a no-op.
  await deleteLmsUserByEmail(EMAIL).catch(() => undefined);
});

test("admin: create employee → row appears in list", async ({ adminPage }) => {
  await adminPage.goto("/app/admin/employees");

  // The "New employee" link/button — try a few selectors since the exact
  // copy may vary.
  const newBtn = adminPage.getByRole("link", { name: /new employee|add employee/i });
  await newBtn.first().click();

  await adminPage.fill('input[name="first_name"]', FIRST);
  await adminPage.fill('input[name="last_name"]', LAST);
  await adminPage.fill('input[name="email"]', EMAIL);
  await adminPage.fill('input[name="phone"]', PHONE);

  // Department + employer dropdowns: pick the first non-empty option.
  const dept = adminPage.locator('select[name="department_id"]');
  if (await dept.count()) {
    const firstDept = await dept.locator("option").nth(1).getAttribute("value");
    if (firstDept) await dept.selectOption(firstDept);
  }
  const employerName = adminPage.locator('input[name="employer_name"]');
  if (await employerName.count()) {
    await employerName.fill("E2E Co");
  }

  await adminPage.getByRole("button", { name: /save|create|add/i }).click();
  await adminPage.waitForURL(/\/app\/admin\/employees/, { timeout: 15_000 });

  await expect(adminPage.getByText(EMAIL)).toBeVisible({ timeout: 10_000 });
});
