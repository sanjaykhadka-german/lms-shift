// Hourly cron entry point for the ShiftCraft auto clock-out.
//
// Closes forgotten clock-ins across EVERY tenant so it happens reliably in the
// background, not only when a manager opens timesheets/clock-now (the in-app
// throttled sweep). Wired in render.yaml as `shiftcraft-stale-clock-outs`.
//
// Mirrors apps/lms-web/scripts/run-whs-reminders.ts: enumerate tenants, do the
// per-tenant work, write a summary audit row. The actual close logic lives in
// ~/lib/clock-sweep (shared with the in-app button + page-load sweep).
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load the workspace-root .env for LOCAL runs (mirrors scripts/with-env.mjs).
// On Render the cron service injects DATABASE_URL et al. into process.env, so
// existing values are never overwritten and this is effectively a no-op there.
const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, "../../../.env"), resolve(here, "../.env.local")]) {
  if (!existsSync(file)) continue;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const valueRaw = match[2];
    if (key === undefined || valueRaw === undefined) continue;
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

// Imported dynamically AFTER env loading: @tracey/db reads DATABASE_URL at
// module init and throws if it's missing.
const { db, tenants, auditEvents } = await import("@tracey/db");
const { sweepStaleClockIns } = await import("../lib/clock-sweep");

const rows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);

let totalClosed = 0;
let totalSkipped = 0;
let tenantsProcessed = 0;
const failures: Array<{ tenantId: string; error: string }> = [];

for (const row of rows) {
  try {
    const { closed, skipped } = await sweepStaleClockIns(row.id);
    totalClosed += closed;
    totalSkipped += skipped;
    tenantsProcessed += 1;
    if (closed > 0 || skipped > 0) {
      console.log(
        `[sweep-clock-outs] ${row.name} (${row.id}): closed ${closed}, skipped ${skipped}`,
      );
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    failures.push({ tenantId: row.id, error });
    console.error(`[sweep-clock-outs] failed for tenant ${row.id}:`, err);
  }
}

try {
  await db.insert(auditEvents).values({
    tenantId: null,
    actorUserId: null,
    actorEmail: null,
    action: "cron.sweep_clock_ins.run",
    targetKind: "cron",
    targetId: "sweep-clock-ins",
    details: {
      tenantsProcessed,
      tenantsTotal: rows.length,
      closed: totalClosed,
      skipped: totalSkipped,
      failures,
    } as never,
  });
} catch (err) {
  console.error("[sweep-clock-outs] summary audit insert failed:", err);
}

console.log(
  `[sweep-clock-outs] done — closed ${totalClosed}, skipped ${totalSkipped} across ${tenantsProcessed}/${rows.length} tenant(s)` +
    (failures.length ? `, ${failures.length} failure(s)` : ""),
);

process.exit(failures.length > 0 ? 1 : 0);
