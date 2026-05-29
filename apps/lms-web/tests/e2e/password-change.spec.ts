import { test, expect } from "./_setup/auth";
import { signOut, signIn } from "./_setup/auth";

const NEW = process.env.E2E_PASSWORD_NEW;

// Skipped unless E2E_PASSWORD_NEW is set explicitly. Round-trips: change
// to NEW, sign out, sign in with NEW, change it back to the original.

test.skip(
  !NEW || NEW.length < 8,
  "Set E2E_PASSWORD_NEW (>= 8 chars) to enable this destructive spec.",
);

test("profile: change password → sign in with new password → change back", async ({
  adminPage,
}) => {
  const email = process.env.E2E_EMAIL!;
  const oldPw = process.env.E2E_PASSWORD!;
  const newPw = NEW!;

  // 1. Change to new password.
  await adminPage.goto("/app/profile");
  await adminPage.fill('input[name="current"]', oldPw);
  await adminPage.fill('input[name="next"]', newPw);
  await adminPage.fill('input[name="confirm"]', newPw);
  await adminPage.getByRole("button", { name: /update password/i }).click();
  await expect(adminPage.getByText(/Password updated\.?/)).toBeVisible({
    timeout: 10_000,
  });

  // 2. Sign out and back in with new password.
  await signOut(adminPage);
  await signIn(adminPage, email, newPw);

  // 3. Change back to old password.
  await adminPage.goto("/app/profile");
  await adminPage.fill('input[name="current"]', newPw);
  await adminPage.fill('input[name="next"]', oldPw);
  await adminPage.fill('input[name="confirm"]', oldPw);
  await adminPage.getByRole("button", { name: /update password/i }).click();
  await expect(adminPage.getByText(/Password updated\.?/)).toBeVisible({
    timeout: 10_000,
  });
});
