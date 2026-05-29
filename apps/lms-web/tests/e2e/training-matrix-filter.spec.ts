import { test, expect } from "./_setup/auth";

test("admin: training matrix narrows when a department is selected", async ({
  adminPage,
}) => {
  await adminPage.goto("/app/admin/training-matrix");

  // Make sure the page rendered the matrix (not the empty state).
  const dept = adminPage.locator('select[name="dept"]');
  await expect(dept).toBeVisible({ timeout: 10_000 });

  // Pick the first real department (skipping the "All" option at index 0).
  const optCount = await dept.locator("option").count();
  test.skip(optCount < 2, "No departments configured in this tenant.");
  const firstDeptValue = await dept.locator("option").nth(1).getAttribute("value");
  if (!firstDeptValue) test.skip(true, "Department option missing value.");

  const beforeRows = await adminPage.locator("table tbody tr").count();

  await dept.selectOption(firstDeptValue!);
  await adminPage.getByRole("button", { name: /apply/i }).click();

  await adminPage.waitForURL(/dept=/);
  const afterRows = await adminPage.locator("table tbody tr").count();

  // The filter should not produce more rows than the unfiltered view, and
  // it should produce at least one row (assuming the chosen dept has staff).
  expect(afterRows).toBeLessThanOrEqual(beforeRows);
  expect(afterRows).toBeGreaterThan(0);
});
