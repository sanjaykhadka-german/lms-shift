// Load monorepo-root .env before applying fallbacks. Tests that mock
// @tracey/db (most of them) don't care what DATABASE_URL is, but
// integration tests like tests/per-tenant-provision.test.ts hit the live
// dev DB and need the real URL. First-wins: shell-set vars still win.
import fs from "node:fs";
import path from "node:path";

const repoRootEnv = path.resolve(__dirname, "../../../.env");
if (fs.existsSync(repoRootEnv)) {
  const content = fs.readFileSync(repoRootEnv, "utf8");
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

// Required env so module-level code in lib/stripe.ts and @tracey/db can load
// without throwing during import-time of unit-tested modules.
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:4000";
