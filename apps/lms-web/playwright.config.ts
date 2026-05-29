import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── env loading at config time ──────────────────────────────────────────
//
// Playwright workers are forked from THIS process, so any process.env we
// set here is inherited by every worker. We load the same files Next dev
// loads (apps/lms-web/.env, .env.local) plus the monorepo root .env (the
// canonical home for DATABASE_URL on this checkout) and the gitignored
// .env.test.local for E2E credentials. First-wins precedence so the shell
// can still override by exporting before invoking `pnpm playwright`.

function loadDotEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
loadDotEnvFile(path.join(here, ".env.test.local"));
loadDotEnvFile(path.join(here, ".env.local"));
loadDotEnvFile(path.join(here, ".env"));
loadDotEnvFile(path.join(repoRoot, ".env"));

// ── config ──────────────────────────────────────────────────────────────

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // serial: many specs share state via the test admin
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/_setup/global.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
