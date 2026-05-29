// Sibling to check-tenant-scope.mjs that targets the per-tenant CLIs and the
// per-tenant-schema source. The existing tenant-scope guard only scans
// apps/lms-web/* and only fires on Drizzle-table-import patterns, so it
// misses the CLI files in packages/db/src/cli that build raw SQL with
// `public.<lms_table>` literals.
//
// Heuristic: in any of the scanned files, if a string literal references
// `public.<lms_table>` (one of the 19 known LMS tables), the same file
// must contain `set_config('app.tenant_id'` somewhere — proving the file
// sets the RLS GUC before issuing DML. Files that ONLY do DDL on public.*
// (e.g. tenant-freeze) are not subject to RLS and can opt out with
// `// allow-ddl-only` at file scope.
//
// Catches the bug class that bit Stage 3 prod cutover on 2026-05-08:
// tenant-copy, tenant-backup, and tenant-provision all silently no-op'd
// under prod's enforced RLS because none set app.tenant_id.
//
// Run:
//   node apps/lms-web/scripts/check-cli-rls-scope.mjs
//   STRICT=1 ... — flag identical (no advisory mode for this check)
//
// Exit codes:
//   0 — clean
//   1 — at least one file references public.lms_* without set_config

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

// Scan everything under packages/db/src/ recursively. Catches the per-tenant
// CLI scripts (cli/*.ts), per-tenant-schema.ts, per-tenant-verify.ts,
// per-tenant-migrate.ts, plus anything new added later. Pure declaration
// files (schema.ts, lms-schema.ts) don't match the heuristic — they use
// pgTable("modules", …) without the literal `public.modules` substring.
const SCAN_FILES_FIXED = [];
const SCAN_DIRS = ["packages/db/src"];

const LMS_TABLES = [
  "departments", "employers", "machines", "positions", "modules",
  "assignments", "attempts", "content_items", "content_item_media",
  "module_media", "questions", "choices", "module_versions",
  "uploaded_files", "department_module_policies", "user_machines",
  "machine_modules", "whs_records", "audit_logs",
];

// Match `public.<table>` or `public."<table>"` for any LMS table.
const PUBLIC_LMS_RE = new RegExp(
  `public\\.\\"?(${LMS_TABLES.join("|")})\\b`,
);
const SET_CONFIG_RE = /set_config\s*\(\s*['"]app\.tenant_id['"]/;
const ALLOW_DDL_ONLY_RE = /\/\/\s*allow-ddl-only\b/;

function stripComments(src) {
  // Strip // line comments and /* block */ comments. Keeps string and
  // template literals intact. The comment forms are matched first;
  // anything inside a string literal is left alone because we only
  // strip comments, not text inside quotes. Loose but adequate.
  return src
    .replace(/\/\/[^\n]*\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && /\.ts$/.test(name)) {
      yield full;
    }
  }
}

async function gatherFiles() {
  const out = [];
  for (const rel of SCAN_FILES_FIXED) {
    out.push(path.join(repoRoot, rel));
  }
  for (const rel of SCAN_DIRS) {
    for await (const f of walk(path.join(repoRoot, rel))) out.push(f);
  }
  return out;
}

const violations = [];

for (const abs of await gatherFiles()) {
  const src = await readFile(abs, "utf8");
  if (ALLOW_DDL_ONLY_RE.test(src)) continue;
  const codeOnly = stripComments(src);
  if (!PUBLIC_LMS_RE.test(codeOnly)) continue;
  if (SET_CONFIG_RE.test(codeOnly)) continue;

  const samples = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PUBLIC_LMS_RE.test(lines[i])) {
      samples.push(`${i + 1}: ${lines[i].trim()}`);
      if (samples.length >= 3) break;
    }
  }
  violations.push({
    file: path.relative(repoRoot, abs).replace(/\\/g, "/"),
    samples,
  });
}

if (violations.length === 0) {
  console.log(
    "check-cli-rls-scope: clean. Every db CLI / per-tenant-schema file that touches public.lms_* sets app.tenant_id.",
  );
  process.exit(0);
}

console.error(
  `check-cli-rls-scope: ${violations.length} file(s) reference public.lms_* without set_config('app.tenant_id'):`,
);
for (const v of violations) {
  console.error(`  ${v.file}`);
  for (const s of v.samples) console.error(`    ${s}`);
}
console.error(
  "\nWrap reads/writes in db.transaction((tx) => { ... set_config('app.tenant_id', tid, true) ... }) at the top, or",
);
console.error(
  "add `// allow-ddl-only` somewhere in the file if it ONLY issues ALTER TABLE on public.lms_* (DDL bypasses RLS).",
);
process.exit(1);
