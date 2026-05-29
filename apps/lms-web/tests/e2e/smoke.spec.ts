import { test, expect } from "./_setup/auth";

// Smoke: every key signed-in route loads without console errors and renders
// a recognisable header. Catches the "I just deployed and the page 500s"
// class of regression.

const ROUTES: Array<{ path: string; heading: RegExp }> = [
  { path: "/app", heading: /./ }, // app shell, no consistent h1
  { path: "/app/profile", heading: /^Profile$/ },
  { path: "/app/my/modules", heading: /modules?/i },
  { path: "/app/members", heading: /members|team/i },
  { path: "/app/admin", heading: /^Admin$/ },
  { path: "/app/admin/employees", heading: /employees/i },
  { path: "/app/admin/modules", heading: /modules/i },
  { path: "/app/admin/modules/ai-studio", heading: /AI Studio/i },
  { path: "/app/admin/training-matrix", heading: /training matrix/i },
  { path: "/app/admin/assignments", heading: /assignments/i },
  { path: "/app/admin/audit-logs", heading: /audit/i },
];

for (const { path, heading } of ROUTES) {
  test(`smoke: ${path} renders without console errors`, async ({
    adminPage,
  }) => {
    const errors: string[] = [];
    adminPage.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    adminPage.on("pageerror", (err) => errors.push(err.message));

    const res = await adminPage.goto(path, { waitUntil: "domcontentloaded" });
    expect(res, `no response for ${path}`).not.toBeNull();
    expect(res!.status(), `${path} returned ${res!.status()}`).toBeLessThan(400);

    // Sanity: at least one h1 or h2 should match the expected heading regex.
    const h = adminPage.locator("h1, h2").first();
    await expect(h, `no heading on ${path}`).toBeVisible({ timeout: 10_000 });
    if (heading.source !== ".") {
      await expect(h).toHaveText(heading);
    }

    // No browser console errors during this navigation.
    expect(errors, `console errors on ${path}: ${errors.join(" | ")}`).toEqual(
      [],
    );
  });
}
