/**
 * Daily WHS reminder cron — Phase 5 successor to Flask's lazy
 * `process_whs_reminders()` that ran on each admin GET. Without Flask, no
 * admin GET ever fires that path, so reminders silently stop. This script
 * iterates every tenant and emails any WHS record expiring within
 * WHS_REMINDER_LOOKAHEAD_DAYS (default 30) that hasn't been reminded in the
 * last WHS_REMINDER_COOLDOWN_DAYS (default 14).
 *
 * Wired to a Render cron in render.yaml at 06:00 Australia/Sydney daily.
 *
 * Run locally with:  pnpm --filter lms-web run cron:whs-reminders
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { db, tenants } from "@tracey/db";
import { runWhsReminders } from "../lib/lms/reminders";
import { logAuditEvent } from "../lib/audit";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

async function main(): Promise<void> {
  const rows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);

  let totalSent = 0;
  let tenantsProcessed = 0;
  const failures: Array<{ tenantId: string; error: string }> = [];
  for (const row of rows) {
    try {
      const sent = await runWhsReminders(row.id);
      totalSent += sent;
      tenantsProcessed += 1;
      if (sent > 0) {
        console.log(`[whs-reminders] ${row.name} (${row.id}): sent ${sent}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ tenantId: row.id, error: msg });
      console.error(`[whs-reminders] failed for tenant ${row.id}:`, err);
    }
  }

  // Audit-event sink so each run is observable post-hoc:
  //   SELECT * FROM app.audit_events
  //    WHERE action = 'cron.whs_reminders.run'
  //    ORDER BY created_at DESC LIMIT 10;
  // Gives a paper trail independent of Render's log retention window.
  await logAuditEvent({
    action: "cron.whs_reminders.run",
    targetKind: "cron",
    targetId: "whs-reminders",
    details: {
      tenantsProcessed,
      tenantsTotal: rows.length,
      emailsSent: totalSent,
      failures,
    },
  });

  console.log(
    `[whs-reminders] done — ${totalSent} email(s) across ${tenantsProcessed}/${rows.length} tenant(s)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[whs-reminders] fatal:", err);
    process.exit(1);
  });
