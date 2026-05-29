// Apply tests/_setup/test-rls-role.sql against the local lms_dev database.
// One-time setup; idempotent. Refuses to run against non-localhost hosts
// unless SETUP_TEST_RLS_ROLE_FORCE=1 is set.
//
// After this lands, set RLS_TEST_DATABASE_URL in your shell to enable the
// per-tenant-rls regression test:
//
//   $env:RLS_TEST_DATABASE_URL = 'postgresql://tracey_test_rls:tracey_test_rls@localhost:5432/lms_dev'
//   pnpm -C apps/lms-web test
//
// Without RLS_TEST_DATABASE_URL set, the test is skipped.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[setup:test-rls-role] DATABASE_URL not set");
  process.exit(1);
}

const url = new URL(databaseUrl);
const isLocal =
  url.hostname === "localhost" ||
  url.hostname === "127.0.0.1" ||
  url.hostname === "::1";
if (!isLocal && process.env.SETUP_TEST_RLS_ROLE_FORCE !== "1") {
  console.error(
    `[setup:test-rls-role] refuses non-local host '${url.hostname}'. Set SETUP_TEST_RLS_ROLE_FORCE=1 to override (only for known-disposable DBs).`,
  );
  process.exit(1);
}

const sqlPath = path.resolve(here, "..", "tests", "_setup", "test-rls-role.sql");
const sqlText = await fs.readFile(sqlPath, "utf8");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await sql.unsafe(sqlText);
  const rlsUrl = `postgresql://tracey_test_rls:tracey_test_rls@${url.hostname}:${url.port || 5432}${url.pathname}`;
  console.log(`[setup:test-rls-role] applied to ${url.hostname}${url.pathname}`);
  console.log("");
  console.log("Now set this env var in the shell where you run vitest:");
  console.log(`  $env:RLS_TEST_DATABASE_URL = '${rlsUrl}'`);
  console.log("");
  console.log("Then `pnpm -C apps/lms-web test` will pick up the per-tenant-rls regression test.");
} catch (e) {
  console.error("[setup:test-rls-role] failed:", e.message);
  process.exit(1);
} finally {
  await sql.end();
}
