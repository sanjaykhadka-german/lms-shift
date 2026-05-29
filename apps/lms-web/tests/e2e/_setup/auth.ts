import { test as base, expect, type Page } from "@playwright/test";

/**
 * Sign in via the credentials form. Returns once we've landed on /app and
 * the topbar avatar is visible (proving the session cookie + RSC payload
 * arrived). Throws otherwise.
 */
export async function signIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL(/\/app(\/|$)/, { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
  await expect(page.locator('button[aria-label="User menu"]')).toBeVisible({
    timeout: 10_000,
  });
}

export async function signOut(page: Page): Promise<void> {
  await page.click('button[aria-label="User menu"]');
  await page.getByRole("menuitem", { name: /sign out/i }).click();
  await page.waitForURL(/\/(sign-in|$)/, { timeout: 10_000 });
}

/**
 * Playwright fixture: a page that's already signed in as the test admin.
 * Use as: `test('foo', async ({ adminPage }) => { ... })`.
 */
export const test = base.extend<{ adminPage: Page }>({
  adminPage: async ({ page }, use) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (!email || !password) {
      throw new Error("E2E_EMAIL / E2E_PASSWORD missing — see global setup");
    }
    await signIn(page, email, password);
    await use(page);
  },
});

export { expect };
