// ShiftCraft demo seed.
//
// Populates one tenant's per-tenant schema with realistic-looking sample
// data: a few locations (with accent colors), employees (with hourly
// rates), clock-event history across the last two weeks, a handful of
// tasks across statuses, and a pinned announcement.
//
// Idempotent — locations/employees are matched by name/email so re-runs
// won't duplicate them; tasks + announcements skip if any already exist.
// --reset wipes ShiftCraft data for the tenant first.
//
// Usage:
//   pnpm db:seed-shiftcraft <tenant-uuid>
//   pnpm db:seed-shiftcraft <tenant-uuid> --reset

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Load env BEFORE the postgres pool is constructed below. Schema modules
// (shiftcraft-schema, schema) don't touch process.env at import time so
// they're safe to static-import; only client.ts throws on missing
// DATABASE_URL — which is why this CLI never imports client.ts.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

import {
  scAnnouncements,
  scClockEvents,
  scDepartments,
  scEmployees,
  scLocations,
  scTasks,
} from "../shiftcraft-schema";
import { members, users as appUsers } from "../schema";

const LOCATIONS: Array<{ name: string; timezone: string; color: string; address: string }> = [
  { name: "Brunswick Store", timezone: "Australia/Melbourne", color: "#7c1f1f", address: "123 Lygon St, Brunswick VIC 3056" },
  { name: "Fitzroy Counter", timezone: "Australia/Melbourne", color: "#1b2845", address: "55 Brunswick St, Fitzroy VIC 3065" },
  { name: "Prep Kitchen", timezone: "Australia/Melbourne", color: "#c89b3c", address: "Unit 4, 12 Hope St, Brunswick VIC 3056" },
];

const EMPLOYEE_SEEDS: Array<{
  fullName: string;
  email: string;
  mobile: string;
  department: string;
  employmentType: "full_time" | "part_time" | "casual" | "contractor";
  hourlyRate: string | null;
}> = [
  { fullName: "Lena Müller", email: "lena@butchery.test", mobile: "0400 111 222", department: "Butchery", employmentType: "full_time", hourlyRate: "32.50" },
  { fullName: "Tomas Novak", email: "tomas@butchery.test", mobile: "0400 222 333", department: "Butchery", employmentType: "full_time", hourlyRate: "30.00" },
  { fullName: "Priya Shah", email: "priya@butchery.test", mobile: "0400 333 444", department: "Counter", employmentType: "casual", hourlyRate: "28.50" },
  { fullName: "Jin Park", email: "jin@butchery.test", mobile: "0400 444 555", department: "Counter", employmentType: "casual", hourlyRate: "28.50" },
  { fullName: "Marta Silva", email: "marta@butchery.test", mobile: "0400 555 666", department: "Prep", employmentType: "part_time", hourlyRate: "29.00" },
  { fullName: "Dan O'Brien", email: "dan@butchery.test", mobile: "0400 666 777", department: "Cleaning", employmentType: "contractor", hourlyRate: null },
];

const TASKS: Array<{
  title: string;
  description: string;
  status: "open" | "in_progress" | "done";
  priority: "low" | "normal" | "high" | "urgent";
  daysFromToday: number | null;
}> = [
  { title: "Order replacement knife sharpener", description: "Old one's giving up — get the Anvil 1500 from Mundial.", status: "open", priority: "high", daysFromToday: 3 },
  { title: "Deep clean Brunswick cool room", description: "Quarterly. Allow 2 hours after close.", status: "open", priority: "normal", daysFromToday: 5 },
  { title: "Update allergen labels for sausage range", description: "New gluten-free Bockwurst added.", status: "in_progress", priority: "high", daysFromToday: 1 },
  { title: "Train new casuals on EFTPOS", description: "Schedule a 30-min session with Priya and Jin.", status: "in_progress", priority: "normal", daysFromToday: 7 },
  { title: "Stocktake completed for May", description: "All reconciled with point-of-sale.", status: "done", priority: "normal", daysFromToday: null },
];

interface LocalShift {
  date: string;
  startHour: number;
  endHour: number;
  breakHour?: number;
  breakMinutes?: number;
  locationIndex: number;
}

function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - dow);
  return r;
}

function localDate(dateStr: string, hour: number, minute = 0): Date {
  const [y, m, dd] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, dd!, hour, minute, 0, 0);
}

function buildShiftPlan(weeksBack: number): Array<{ employeeEmail: string; shifts: LocalShift[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const periodStart = addDays(startOfWeek(today), -7 * weeksBack);
  const employeeShifts: Record<string, LocalShift[]> = {};
  for (const e of EMPLOYEE_SEEDS) employeeShifts[e.email] = [];

  for (let w = 0; w < weeksBack + 1; w++) {
    for (let d = 0; d < 6; d++) {
      const day = addDays(periodStart, w * 7 + d);
      const dateStr = fmtIsoDate(day);
      if (d < 5) {
        employeeShifts["lena@butchery.test"]!.push({ date: dateStr, startHour: 7, endHour: 15, breakHour: 11, breakMinutes: 30, locationIndex: 0 });
        employeeShifts["tomas@butchery.test"]!.push({ date: dateStr, startHour: 8, endHour: 16, breakHour: 12, breakMinutes: 30, locationIndex: 0 });
      }
      const counterCrew = d === 5
        ? ["priya@butchery.test", "jin@butchery.test"]
        : d % 2 === 0
          ? ["priya@butchery.test"]
          : ["jin@butchery.test"];
      for (const email of counterCrew) {
        employeeShifts[email]!.push({ date: dateStr, startHour: 9, endHour: d === 5 ? 14 : 17, breakHour: 12, breakMinutes: 30, locationIndex: 1 });
      }
      if (d === 0 || d === 2 || d === 4) {
        employeeShifts["marta@butchery.test"]!.push({ date: dateStr, startHour: 6, endHour: 12, breakHour: 9, breakMinutes: 15, locationIndex: 2 });
      }
    }
  }
  return Object.entries(employeeShifts).map(([email, shifts]) => ({ employeeEmail: email, shifts }));
}

async function main() {
  const [, , tenantId, ...flags] = process.argv;
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    console.error("usage: pnpm db:seed-shiftcraft <tenant-uuid> [--reset]");
    process.exit(2);
  }
  const reset = flags.includes("--reset");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[seed-shiftcraft] DATABASE_URL is required");
    process.exit(1);
  }

  const pg = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(pg);

  const t = (await db.execute(
    drizzleSql`SELECT id::text AS id, slug FROM app.tenants WHERE id = ${tenantId}::uuid LIMIT 1`,
  )) as unknown as Array<{ id: string; slug: string }>;
  if (t.length === 0) {
    console.error(`[seed-shiftcraft] tenant ${tenantId} not found`);
    await pg.end();
    process.exit(1);
  }
  console.log(`[seed-shiftcraft] tenant ${t[0]!.slug} (${tenantId})`);

  // Inline forTenant.run — same body as packages/db/src/client.ts but
  // bound to this script's local connection so we don't pull in the
  // module-level postgres pool from client.ts.
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const schemaIdent = `"tenant_${tenantId}"`;
  const runInTenant = async <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
    return db.transaction(async (tx) => {
      await tx.execute(
        drizzleSql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );
      await tx.execute(
        drizzleSql.raw(`SET LOCAL search_path = ${schemaIdent}, public`),
      );
      return fn(tx);
    });
  };

  if (reset) {
    console.log("[seed-shiftcraft] --reset: wiping ShiftCraft tables in tenant");
    await runInTenant(async (tx) => {
      await tx.execute(drizzleSql`DELETE FROM sc_clock_events`);
      await tx.execute(drizzleSql`DELETE FROM sc_tasks`);
      await tx.execute(drizzleSql`DELETE FROM sc_announcements`);
      await tx.execute(drizzleSql`DELETE FROM sc_shift_swap_requests`);
      await tx.execute(drizzleSql`DELETE FROM sc_shift_assignments`);
      await tx.execute(drizzleSql`DELETE FROM sc_shifts`);
      await tx.execute(drizzleSql`DELETE FROM sc_time_off_requests`);
      await tx.execute(drizzleSql`DELETE FROM sc_employees`);
      await tx.execute(drizzleSql`DELETE FROM sc_departments`);
      await tx.execute(drizzleSql`DELETE FROM sc_locations`);
    });
  }

  // Departments — upsert by (tenant, lower(name)).
  const departmentIds: Record<string, string> = {};
  const distinctDeptNames = Array.from(
    new Set(EMPLOYEE_SEEDS.map((e) => e.department)),
  );
  for (const deptName of distinctDeptNames) {
    const existing = await runInTenant((tx) =>
      tx
        .select({ id: scDepartments.id })
        .from(scDepartments)
        .where(
          and(
            eq(scDepartments.traceyTenantId, tenantId),
            drizzleSql`lower(${scDepartments.name}) = lower(${deptName})`,
          ),
        )
        .limit(1),
    );
    if (existing.length > 0) {
      departmentIds[deptName] = existing[0]!.id;
      continue;
    }
    const inserted = await runInTenant((tx) =>
      tx
        .insert(scDepartments)
        .values({ traceyTenantId: tenantId, name: deptName })
        .returning({ id: scDepartments.id }),
    );
    departmentIds[deptName] = inserted[0]!.id;
    console.log(`  + department ${deptName}`);
  }

  const locationIds: Record<string, string> = {};
  for (const loc of LOCATIONS) {
    const existing = await runInTenant((tx) =>
      tx
        .select({ id: scLocations.id })
        .from(scLocations)
        .where(and(eq(scLocations.traceyTenantId, tenantId), eq(scLocations.name, loc.name)))
        .limit(1),
    );
    if (existing.length > 0) {
      locationIds[loc.name] = existing[0]!.id;
      continue;
    }
    const inserted = await runInTenant((tx) =>
      tx
        .insert(scLocations)
        .values({
          traceyTenantId: tenantId,
          name: loc.name,
          timezone: loc.timezone,
          address: loc.address,
          color: loc.color,
        })
        .returning({ id: scLocations.id }),
    );
    locationIds[loc.name] = inserted[0]!.id;
    console.log(`  + location ${loc.name}`);
  }

  const employeeAppUserIds: Record<string, string | null> = {};
  for (const e of EMPLOYEE_SEEDS) {
    const existing = await runInTenant((tx) =>
      tx
        .select({ id: scEmployees.id, appUserId: scEmployees.appUserId })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            drizzleSql`lower(${scEmployees.email}) = lower(${e.email})`,
          ),
        )
        .limit(1),
    );
    let appUserId: string | null = existing[0]?.appUserId ?? null;
    if (!appUserId) {
      const u = await db
        .select({ id: appUsers.id })
        .from(appUsers)
        .where(eq(appUsers.email, e.email))
        .limit(1);
      appUserId = u[0]?.id ?? null;
    }
    if (existing.length > 0) {
      employeeAppUserIds[e.email] = appUserId;
      continue;
    }
    await runInTenant((tx) =>
      tx.insert(scEmployees).values({
        traceyTenantId: tenantId,
        fullName: e.fullName,
        email: e.email,
        mobile: e.mobile,
        departmentId: departmentIds[e.department] ?? null,
        employmentType: e.employmentType,
        hourlyRate: e.hourlyRate,
        appUserId,
      }),
    );
    employeeAppUserIds[e.email] = appUserId;
    console.log(`  + employee ${e.fullName}${appUserId ? " (linked to login)" : " (no login)"}`);
  }

  const plan = buildShiftPlan(1);
  let clockEventsInserted = 0;
  for (const { employeeEmail, shifts } of plan) {
    const appUserId = employeeAppUserIds[employeeEmail];
    if (!appUserId) continue;
    for (const s of shifts) {
      const locationKey = LOCATIONS[s.locationIndex]!.name;
      const locationId = locationIds[locationKey] ?? null;
      const inAt = localDate(s.date, s.startHour);
      const outAt = localDate(s.date, s.endHour);
      const events: Array<Record<string, unknown>> = [
        { traceyTenantId: tenantId, appUserId, locationId, eventType: "in", occurredAt: inAt, source: "manual" },
      ];
      if (s.breakHour != null && s.breakMinutes != null) {
        const breakStart = localDate(s.date, s.breakHour);
        const breakEnd = new Date(breakStart.getTime() + s.breakMinutes * 60_000);
        events.push({ traceyTenantId: tenantId, appUserId, locationId, eventType: "break_start", occurredAt: breakStart, source: "manual" });
        events.push({ traceyTenantId: tenantId, appUserId, locationId, eventType: "break_end", occurredAt: breakEnd, source: "manual" });
      }
      events.push({ traceyTenantId: tenantId, appUserId, locationId, eventType: "out", occurredAt: outAt, source: "manual" });
      await runInTenant((tx) => tx.insert(scClockEvents).values(events as never));
      clockEventsInserted += events.length;
    }
  }
  console.log(`  + ${clockEventsInserted} clock events`);

  const eligibleAssignees = Object.values(employeeAppUserIds).filter(
    (v): v is string => v != null,
  );
  const taskExisting = await runInTenant((tx) =>
    tx
      .select({ id: scTasks.id })
      .from(scTasks)
      .where(eq(scTasks.traceyTenantId, tenantId))
      .limit(1),
  );
  if (taskExisting.length === 0) {
    let taskIdx = 0;
    for (const t of TASKS) {
      const dueDate = t.daysFromToday != null
        ? fmtIsoDate(addDays(new Date(), t.daysFromToday))
        : null;
      const assignee = eligibleAssignees.length > 0
        ? eligibleAssignees[taskIdx % eligibleAssignees.length]!
        : null;
      await runInTenant((tx) =>
        tx.insert(scTasks).values({
          traceyTenantId: tenantId,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          dueDate,
          assigneeUserId: assignee,
          completedAt: t.status === "done" ? new Date() : null,
        }),
      );
      taskIdx += 1;
    }
    console.log(`  + ${TASKS.length} tasks`);
  } else {
    console.log("  · tasks already seeded, skipping");
  }

  const annExisting = await runInTenant((tx) =>
    tx
      .select({ id: scAnnouncements.id })
      .from(scAnnouncements)
      .where(and(eq(scAnnouncements.traceyTenantId, tenantId), eq(scAnnouncements.pinned, true)))
      .limit(1),
  );
  if (annExisting.length === 0) {
    const owner = await db
      .select({ userId: members.userId })
      .from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.role, "owner")))
      .limit(1);
    await runInTenant((tx) =>
      tx.insert(scAnnouncements).values({
        traceyTenantId: tenantId,
        title: "Welcome to ShiftCraft",
        body: "Hi team! This is your roster home. Clock in from the Time clock page, request time off, swap shifts, and check tasks from the board. Reach out to a manager if you can't see what you expect.",
        pinned: true,
        createdByUserId: owner[0]?.userId ?? null,
      }),
    );
    console.log("  + welcome announcement");
  } else {
    console.log("  · pinned announcement already present, skipping");
  }

  await pg.end();
  console.log("[seed-shiftcraft] done");
}

main().catch((err) => {
  console.error("[seed-shiftcraft] failed:", err);
  process.exit(1);
});
