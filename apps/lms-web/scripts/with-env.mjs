// Loads the workspace-root .env into process.env, then execs `next` with
// the args passed through. Used by the dev/build/start scripts so the whole
// monorepo shares one .env file (mirrors how Render injects env vars).
//
// Why a wrapper rather than dotenv-cli or dotenv-in-next.config? The wrapper
// runs *before* Next.js boots, so NEXT_PUBLIC_* vars are present when Next's
// build-time substitution runs — not just at request time on the server.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../../.env"), // workspace root
  resolve(here, "../.env.local"), // per-app override (gitignored)
];

for (const file of candidates) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, valueRaw] = match;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    let value = valueRaw.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const args = process.argv.slice(2);
const child = spawn("next", args, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[with-env] failed to spawn next:", err);
  process.exit(1);
});
