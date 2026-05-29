import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Load env files in the same precedence Next dev uses, plus our test-local
// override. First-wins (we never overwrite existing process.env), so the
// shell can still override anything by exporting it before invoking pnpm.
function loadEnvForTests() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lmsWebRoot = path.resolve(here, "..", "..", "..");
  const repoRoot = path.resolve(lmsWebRoot, "..", "..");
  loadDotEnvFile(path.join(lmsWebRoot, ".env.test.local")); // E2E creds
  loadDotEnvFile(path.join(lmsWebRoot, ".env.local"));      // Next dev local overrides
  loadDotEnvFile(path.join(lmsWebRoot, ".env"));            // Next dev defaults
  loadDotEnvFile(path.join(repoRoot, ".env"));              // monorepo root (DATABASE_URL etc.)
}

export default async function globalSetup() {
  loadEnvForTests();
  // Warn rather than throw. Specs that depend on E2E_EMAIL/E2E_PASSWORD
  // (smoke, password-change, profile-edit, …) surface the missing creds in
  // their own auth fixture with a clearer message. The cross-tenant
  // isolation spec is self-seeded and doesn't need them, so a hard throw
  // here would block running just that spec on a fresh checkout.
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
    console.warn(
      "[e2e] E2E_EMAIL / E2E_PASSWORD not set — specs that rely on a real " +
        "admin account will fail. See apps/lms-web/.env.test.local.example.",
    );
  }
}
