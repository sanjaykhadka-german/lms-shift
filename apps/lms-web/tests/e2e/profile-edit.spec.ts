import { test, expect } from "./_setup/auth";

// Edit profile phone, save, reload, verify persistence. Restores the
// original phone value at teardown so the suite is repeatable.

test("profile: edit phone persists across reload", async ({ adminPage }) => {
  await adminPage.goto("/app/profile");

  const phone = adminPage.locator('input[name="phone"]');
  const originalPhone = (await phone.inputValue()) ?? "";
  const newPhone = `+61 4${Math.floor(10000000 + Math.random() * 89999999)}`;

  await phone.fill(newPhone);
  await adminPage.getByRole("button", { name: /save/i }).click();
  await expect(adminPage.getByText(/^Saved\.?$/)).toBeVisible({
    timeout: 10_000,
  });

  await adminPage.reload();
  await expect(phone).toHaveValue(newPhone);

  // Restore.
  await phone.fill(originalPhone);
  await adminPage.getByRole("button", { name: /save/i }).click();
  await expect(adminPage.getByText(/^Saved\.?$/)).toBeVisible({
    timeout: 10_000,
  });
});
