import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./_setup/auth";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "avatar.png");

test("profile: upload photo → topbar avatar swaps to image", async ({
  adminPage,
}) => {
  await adminPage.goto("/app/profile");

  // Upload via the hidden file input directly (the visible "Attach"-style
  // button just calls .click() on it).
  await adminPage.setInputFiles('input[name="photo"]', FIXTURE);
  await adminPage.getByRole("button", { name: /save/i }).click();
  await expect(adminPage.getByText(/^Saved\.?$/)).toBeVisible({
    timeout: 15_000,
  });

  // Refresh so the layout re-fetches lmsUser.photoFilename.
  await adminPage.reload();

  // Topbar avatar should now be an <img> with /uploads/ in its src.
  const avatarImg = adminPage.locator(
    'button[aria-label="User menu"] img[src*="/uploads/"]',
  );
  await expect(avatarImg).toBeVisible({ timeout: 10_000 });

  // Cleanup: tick the "Remove photo" checkbox + save so we don't accumulate
  // uploaded_files rows across runs.
  await adminPage.goto("/app/profile");
  const removePhoto = adminPage.locator('input[name="remove_photo"]');
  if (await removePhoto.count()) {
    await removePhoto.check();
    await adminPage.getByRole("button", { name: /save/i }).click();
    await expect(adminPage.getByText(/^Saved\.?$/)).toBeVisible({
      timeout: 10_000,
    });
  }
});
