// ShiftCraft tables — employee shift scheduling.
//
// Row-per-tenant isolation (shared `public.sc_*` tables): every table carries
// `tracey_tenant_id uuid NOT NULL REFERENCES app.tenants(id)`. App-code queries
// run through `ctx.db.run(...)` (= `forTenant(tid).run(...)`), which sets the
// `app.tenant_id` GUC; the RLS policy in `migrations/manual/0001_enable_rls.sql`
// enforces `tracey_tenant_id = the GUC` as defence-in-depth.

import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./schema";

// ─── Locations ───
//
// A physical site where shifts happen. Each tenant has 1..N locations.
// Timezone defaults to Australia/Sydney but can be overridden per site
// (e.g. a franchise with stores across timezones).

export const scLocations = pgTable(
  "sc_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: uuid("tracey_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Australia/Sydney"),
    address: text("address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_locations_tenant_idx").on(t.traceyTenantId),
    check("sc_locations_timezone_chk", sql`length(${t.timezone}) > 0`),
  ],
);

// ─── Shifts ───
//
// Lifecycle: draft → published → (optionally) cancelled.
// Drafts are visible only to managers/admins; published shifts can be offered
// to staff via shift_assignments.

export const scShifts = pgTable(
  "sc_shifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: uuid("tracey_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => scLocations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // e.g. "Butcher", "Cashier", "Cleaner"
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("draft"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_shifts_tenant_starts_idx").on(t.traceyTenantId, t.startsAt),
    index("sc_shifts_location_starts_idx").on(t.locationId, t.startsAt),
    check(
      "sc_shifts_status_chk",
      sql`${t.status} in ('draft','published','cancelled')`,
    ),
    check("sc_shifts_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

// ─── Shift assignments ───
//
// One row per (shift, employee) offer. Status flows:
//   offered → accepted | declined
//                ↓
//             swapped (covered by another employee)
//                ↓
//             no_show (post-shift, if employee didn't turn up)

export const scShiftAssignments = pgTable(
  "sc_shift_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: uuid("tracey_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => scShifts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("offered"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_shift_user_uq").on(t.shiftId, t.userId),
    index("sc_assignments_tenant_idx").on(t.traceyTenantId),
    index("sc_assignments_user_idx").on(t.userId),
    check(
      "sc_assignments_status_chk",
      sql`${t.status} in ('offered','accepted','declined','swapped','no_show')`,
    ),
  ],
);

// ─── Time-off requests ───

export const scTimeOffRequests = pgTable(
  "sc_time_off_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: uuid("tracey_tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_time_off_tenant_idx").on(t.traceyTenantId, t.startDate),
    index("sc_time_off_user_idx").on(t.userId, t.startDate),
    check(
      "sc_time_off_status_chk",
      sql`${t.status} in ('pending','approved','denied','cancelled')`,
    ),
    check("sc_time_off_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

// ─── Inferred types ───

export type ScLocation = typeof scLocations.$inferSelect;
export type NewScLocation = typeof scLocations.$inferInsert;
export type ScShift = typeof scShifts.$inferSelect;
export type NewScShift = typeof scShifts.$inferInsert;
export type ScShiftAssignment = typeof scShiftAssignments.$inferSelect;
export type NewScShiftAssignment = typeof scShiftAssignments.$inferInsert;
export type ScTimeOffRequest = typeof scTimeOffRequests.$inferSelect;
export type NewScTimeOffRequest = typeof scTimeOffRequests.$inferInsert;
export type ScShiftStatus = "draft" | "published" | "cancelled";
export type ScAssignmentStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "swapped"
  | "no_show";
export type ScTimeOffStatus = "pending" | "approved" | "denied" | "cancelled";
