// Tenant-scope guard. Two checks:
//
//  (A) HARD: every `db.<verb>(...)` call on an LMS table must include a
//      `tenantWhere(...)` filter, a `traceyTenantId:` field assignment, a
//      raw `tracey_tenant_id` reference, or an `// allow-cross-tenant`
//      opt-out comment. A miss leaks across tenants. Failures here exit 1.
//
//  (B) ADVISORY: every `db.<verb>(...)` call on an LMS table must also be
//      wrapped in `ctx.db.run(...)`, `forTenant(...).run(...)`, or
//      `db.transaction(...)` so `app.tenant_id` is set for Postgres RLS
//      (migration 0004_enable_rls.sql). Bare `db` calls on LMS tables
//      silently return zero rows once RLS is on. Tracked separately and
//      printed with a count, but DOES NOT fail this script while the
//      ~37-file migration is in flight (Phase 5.5). Flip to fail-mode by
//      setting STRICT=1 once the codebase migration is done.
//
// Run:
//   pnpm -C apps/lms-web check-tenant-scope
//   STRICT=1 pnpm -C apps/lms-web check-tenant-scope   # fail on (B) too
//
// Exit codes:
//   0 — no (A) violations (default), or no (A) and no (B) under STRICT=1
//   1 — at least one (A) violation, or any (B) under STRICT=1
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");

const SCAN_DIRS = [
  path.join(appRoot, "app", "app", "admin"),
  path.join(appRoot, "app", "app", "profile"),
  path.join(appRoot, "app", "app", "my"),
  path.join(appRoot, "app", "api"),
  path.join(appRoot, "lib", "lms"),
  path.join(appRoot, "scripts"),
];

// `\s*` between `db`, `.`, and verb handles drizzle's common multi-line
// chain layout (e.g. `await db\n  .insert(...)`). Without it the regex
// silently misses every split-across-lines call site.
const VERB_RE = /\bdb\s*\.\s*(select|insert|update|delete|execute|selectDistinct)\s*\(/g;
// `db.transaction(...)` opens a tx but DOESN'T set `app.tenant_id`. Inside
// it, queries use `tx.<verb>` (so they don't match VERB_RE), but they're
// still RLS-unsafe. Flag the transaction itself.
const TXN_RE = /\bdb\s*\.\s*transaction\s*\(/g;
// Any of these in the same statement window proves the call is tenant-scoped:
//   - tenantWhere(...)        — canonical LMS helper
//   - traceyTenantId          — column on every legacy LMS row (insert/where)
//   - tracey_tenant_id        — raw SQL form
//   - .tenantId / tenantId:   — Tracey-schema tables (auditEvents, members,
//                                invitations, …) — uuid-keyed, not RLS-covered,
//                                but still tenant-scoped at the app layer.
//   - userId / lmsUser*       — keyed via FK to lmsUsers, which carries
//                                traceyTenantId. Same as `// allow-cross-tenant
//                                via FK` — the row is still scoped, just by
//                                association. RLS will still apply when on.
const TENANT_FILTER_RE =
  /\btenantWhere\s*\(|\btraceyTenantId\b|\btracey_tenant_id\b|\.tenantId\b|\btenantId\s*:|\.userId\b|\blmsUserId\b/;
const ALLOW_RE = /\/\/\s*allow-cross-tenant\b/;
const LMS_IMPORT_RE = /import\s*{[^}]*\blms[A-Z]\w*[^}]*}\s*from\s*["']@tracey\/db["']/;

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
    } else if (st.isFile() && /\.(ts|tsx)$/.test(name)) {
      yield full;
    }
  }
}

function findStatementWindow(source, startIdx) {
  // Drizzle chains span multiple lines (`db.insert(t).values({...})` and
  // `db.select().from(t).where(...).limit(N)`). Walk forward, tracking
  // bracket nesting and skipping string/template literals, until the
  // statement-ending `;` at depth 0. Cap at 4000 chars so a runaway file
  // doesn't blow up the scan.
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let i = startIdx;
  const limit = Math.min(source.length, startIdx + 4000);
  while (i < limit) {
    const ch = source[i];
    // Skip string + template literals.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < limit) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // Skip line + block comments.
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? limit : nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? limit : end + 2;
      continue;
    }
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth--;
    else if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
    else if (
      ch === ";" &&
      parenDepth <= 0 &&
      braceDepth <= 0 &&
      bracketDepth <= 0
    ) {
      return source.slice(startIdx, i + 1);
    }
    i++;
  }
  return source.slice(startIdx, limit);
}

function lineOf(source, idx) {
  return source.slice(0, idx).split("\n").length;
}

const violations = [];   // (A) hard failures — missing tenant filter
const rlsAdvisory = [];  // (B) advisory — bare db on LMS tables, RLS-unsafe

for (const dir of SCAN_DIRS) {
  for await (const file of walk(dir)) {
    const source = await readFile(file, "utf8");
    if (!LMS_IMPORT_RE.test(source)) continue;

    for (const m of source.matchAll(VERB_RE)) {
      const startIdx = m.index ?? 0;
      const window = findStatementWindow(source, startIdx);
      // Look back ~1500 chars to catch filter arrays built earlier in the
      // same function (`const filters = [eq(t.traceyTenantId, tid), …]`
      // followed by `db.select().where(and(...filters))`) — without this
      // pre-window, every drizzle query that hoists its filters fails the
      // (A) check.
      const preWindow = source.slice(Math.max(0, startIdx - 1500), startIdx);
      const before = source.slice(Math.max(0, startIdx - 200), startIdx);
      const allowedLocally =
        ALLOW_RE.test(window) ||
        ALLOW_RE.test(before.split("\n").slice(-3).join("\n"));

      const rel = path.relative(appRoot, file).replace(/\\/g, "/");
      const ln = lineOf(source, startIdx);

      // (A) Hard check: missing tenantWhere/traceyTenantId/tracey_tenant_id.
      if (
        !TENANT_FILTER_RE.test(window) &&
        !TENANT_FILTER_RE.test(preWindow) &&
        !allowedLocally
      ) {
        violations.push(`${rel}:${ln}: db.${m[1]}(...) without tenantWhere() or // allow-cross-tenant`);
        continue;
      }

      // (B) Advisory check: even with a tenant filter, a bare `db.<verb>`
      // call on an LMS-table query is RLS-unsafe. The match itself is
      // already at top-level (not inside `tx => ...`, since that would use
      // `tx.<verb>`, which the VERB_RE doesn't match). The window's
      // tenant-filter signal proves it's an LMS-table query → flag.
      if (!allowedLocally) {
        rlsAdvisory.push(`${rel}:${ln}: db.${m[1]}(...) — wrap in ctx.db.run((tx) => tx.${m[1]}(...)) for RLS readiness`);
      }
    }

    // (B) also covers `db.transaction(...)` — opens a tx but doesn't set
    // `app.tenant_id`. Inner queries on RLS-covered tables fail silently.
    for (const m of source.matchAll(TXN_RE)) {
      const startIdx = m.index ?? 0;
      const window = findStatementWindow(source, startIdx);
      const before = source.slice(Math.max(0, startIdx - 200), startIdx);
      const allowedLocally =
        ALLOW_RE.test(window) ||
        ALLOW_RE.test(before.split("\n").slice(-3).join("\n"));
      if (allowedLocally) continue;
      const rel = path.relative(appRoot, file).replace(/\\/g, "/");
      const ln = lineOf(source, startIdx);
      rlsAdvisory.push(`${rel}:${ln}: db.transaction(...) — replace with forTenant(tid).run((tx) => ...) for RLS readiness`);
    }
  }
}

const strict = process.env.STRICT === "1";

if (violations.length > 0) {
  console.error(`check-tenant-scope (A): ${violations.length} hard violation(s):`);
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Each (A) violation must either:");
  console.error("  • include tenantWhere(<table>, ctx.traceyTenantId) in its WHERE clause, or");
  console.error("  • migrate to ctx.db.run((tx) => tx.<verb>(...)), or");
  console.error("  • add an `// allow-cross-tenant: <reason>` comment if intentional.");
  if (rlsAdvisory.length > 0) console.error("");
}

if (rlsAdvisory.length > 0) {
  console.warn(`check-tenant-scope (B): ${rlsAdvisory.length} RLS-advisory issue(s) — bare db on LMS tables:`);
  for (const v of rlsAdvisory) console.warn("  " + v);
  console.warn("");
  console.warn("Each (B) issue must wrap the call in `ctx.db.run((tx) => tx.<verb>(...))`");
  console.warn("(server actions / pages) or `forTenant(tid).run((tx) => ...)` (cron scripts).");
  console.warn("Phase 5.5 migration in progress — see plan + memory for the full backlog.");
}

if (violations.length > 0) process.exit(1);
if (strict && rlsAdvisory.length > 0) {
  console.error("STRICT=1 set — failing on (B) issues.");
  process.exit(1);
}

if (rlsAdvisory.length === 0) {
  console.log("check-tenant-scope: fully clean (A: 0 violations, B: 0 RLS advisories)");
} else {
  console.log(`check-tenant-scope (A): clean. ${rlsAdvisory.length} RLS advisory issue(s) — see above.`);
}
process.exit(0);
