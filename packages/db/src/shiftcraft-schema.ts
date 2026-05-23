// ShiftCraft tables — employee shift scheduling.
//
// Multi-tenant strategy: PER-TENANT POSTGRES SCHEMA (matches the LMS Phase 7
// pattern in per-tenant-schema.ts). The Drizzle table definitions below are
// declared as unqualified `pgTable("sc_*", ...)` so they emit unqualified
// table names in SQL. Two physical locations exist for each table:
//
//   1. `public.sc_*` — the source/template tables. Created by
//      `pnpm db:migrate-shiftcraft` from this file. App code never queries
//      these directly in tenant-scoped paths; they exist so Drizzle has a
//      stable home and so per-tenant provisioning can use `CREATE TABLE …
//      LIKE INCLUDING ALL` to make the per-tenant copies.
//
//   2. `tenant_<uuid>.sc_*` — the per-tenant copies. Created by the SQL
//      migration `packages/db/migrations/per-tenant/0009_shiftcraft_baseline.sql`
//      which the existing `pnpm db:migrate-tenants` runner applies inside
//      each tenant's schema (with `SET LOCAL search_path = "tenant_<uuid>",
//      public`).
//
// App-code queries go through `ctx.db.run(...)` (= `forTenant(tid).run(...)`)
// which sets `search_path` so unqualified `sc_*` references resolve to the
// per-tenant copy. RLS on each per-tenant table provides defence-in-depth.
//
// `tracey_tenant_id` column is kept on every table (mirroring the LMS
// pattern). Its DEFAULT is set per-tenant inside the baseline SQL so Drizzle
// INSERTs don't need to specify it explicitly.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./schema";

// Drizzle pg-core doesn't ship a bytea helper. Used by sc_clock_event_photos
// to store kiosk selfies as binary blobs (Buffer in JS, BYTEA in Postgres).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ─── Locations ───
//
// A physical site where shifts happen. Each tenant has 1..N locations.
// Timezone defaults to Australia/Sydney but can be overridden per site
// (e.g. a franchise with stores across timezones).

export const scLocations = pgTable(
  "sc_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Australia/Sydney"),
    address: text("address"),
    // Hex color for per-location accent. Validated to "#RRGGBB" (no
    // shorthand) so the UI doesn't need a parser — checked in the DB so
    // bad data can't sneak in via direct SQL either.
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_locations_tenant_idx").on(t.traceyTenantId),
    check("sc_locations_timezone_chk", sql`length(${t.timezone}) > 0`),
    check(
      "sc_locations_color_chk",
      sql`${t.color} is null or ${t.color} ~* '^#[0-9a-f]{6}$'`,
    ),
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
    traceyTenantId: text("tracey_tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
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
    shiftId: uuid("shift_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("offered"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_shift_user_uq").on(t.shiftId, t.userId),
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
    traceyTenantId: text("tracey_tenant_id").notNull(),
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

// FK note: scShifts.locationId → scLocations.id and
// scShiftAssignments.shiftId → scShifts.id are intentionally NOT declared via
// Drizzle .references() here. Both directions exist between sc_* tables, and
// the LIKE-based per-tenant provisioning recreates them inside each tenant
// schema (see migrations/per-tenant/0009_shiftcraft_baseline.sql). Declaring
// them in Drizzle would generate FK constraints in `public.sc_*` that point
// at `public.sc_*` siblings — which is fine for the template, but the same
// constraint name then collides when the per-tenant copy tries to recreate
// the FK pointing at its tenant-schema siblings. Keeping them as bare
// `uuid("...")` columns lets the per-tenant SQL own FK creation.

// ─── Shift swap / cover requests ───
//
// Employee A asks employee B to take a shift A is already assigned to (cover)
// or to trade shifts (swap). Status flows: pending → accepted | declined |
// cancelled. On accept the linked assignment row(s) mutate transactionally
// (the existing scAssignmentStatus enum already reserves 'swapped' for this).
//
// FKs to app.users and to the local sc_shift_assignments are added in the
// per-tenant baseline migration — same convention as scShiftAssignments.

export const scShiftSwapRequests = pgTable(
  "sc_shift_swap_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    initiatorUserId: uuid("initiator_user_id").notNull(),
    initiatorAssignmentId: uuid("initiator_assignment_id").notNull(),
    targetUserId: uuid("target_user_id").notNull(),
    // null = cover (one-way handoff); non-null = swap (two-way trade)
    targetAssignmentId: uuid("target_assignment_id"),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_swap_pending_unique")
      .on(t.initiatorAssignmentId)
      .where(sql`status = 'pending'`),
    index("sc_swap_tenant_idx").on(t.traceyTenantId, t.status, t.createdAt),
    index("sc_swap_target_idx").on(t.targetUserId, t.status),
    check(
      "sc_swap_status_chk",
      sql`${t.status} in ('pending','accepted','declined','cancelled')`,
    ),
    check(
      "sc_swap_distinct_users_chk",
      sql`${t.initiatorUserId} <> ${t.targetUserId}`,
    ),
  ],
);

// ─── Departments ───
//
// Tenant-scoped department / team taxonomy. Promoted from the text
// `department` column that used to live on `sc_employees` so Reports can
// group cleanly and the same name doesn't get spelled three different
// ways across rows. The unique index on `(tenant, lower(name))` keeps
// case-insensitive uniqueness — Drizzle insert / lookup paths normalise
// to whatever case the form sends.

export const scDepartments = pgTable(
  "sc_departments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_departments_tenant_name_uq").on(
      t.traceyTenantId,
      sql`lower(${t.name})`,
    ),
    index("sc_departments_tenant_idx").on(t.traceyTenantId),
  ],
);

// ─── Employees (HR-side roster) ───
//
// ShiftCraft-owned record of someone who can be assigned to shifts. Distinct
// from `app.users` (auth identity) and `app.members` (tenant access) so that
// labour-hire / contractor staff who never need a login still appear on the
// roster. Permanent and casual employees can be linked to their auth user
// (app_user_id) when they have one — for example after self-onboarding or
// when the LMS admin confirms the suggested learner record.
//
// `email` is nullable because labour-hire rows often have only a name +
// mobile. The partial unique index on (tracey_tenant_id, lower(email))
// prevents duplicate emails within a tenant while still allowing many
// null-email rows.
//
// `availability` is jsonb for now — kept flexible while we figure out the
// shape (initial form uses `{ mon: "09-17", tue: "...", ... }`).

export const scEmployees = pgTable(
  "sc_employees",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fullName: text("full_name").notNull(),
    email: text("email"),
    mobile: text("mobile"),
    // Department lives in its own table now — see scDepartments above.
    // The FK is declared via .references() so Drizzle generates the
    // constraint in the public template; the per-tenant migration
    // re-attaches it pointing at the per-tenant copy of sc_departments.
    departmentId: uuid("department_id").references(() => scDepartments.id, {
      onDelete: "set null",
    }),
    availability: jsonb("availability"),
    employmentType: text("employment_type").notNull().default("permanent"),
    // Hourly wage in tenant currency. Nullable so labour-hire / contract
    // employees can be added without forcing a rate (the platform owner
    // sets per-tenant currency; Reports treats nulls as "rate not set").
    hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    // Onboarding workflow status. New hires start at 'pending' (created but
    // not yet walked through the checklist), move to 'in_progress' the first
    // time their checklist is opened, and flip to 'active' once all required
    // tasks are marked done. Default 'active' so historical rows back-fill
    // without breaking existing list/edit pages.
    onboardingStatus: text("onboarding_status").notNull().default("active"),
    onboardingStartedAt: timestamp("onboarding_started_at", {
      withTimezone: true,
    }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_employees_tenant_idx").on(t.traceyTenantId, t.isActive),
    index("sc_employees_app_user_idx").on(t.appUserId),
    index("sc_employees_onboarding_idx").on(
      t.traceyTenantId,
      t.onboardingStatus,
    ),
    uniqueIndex("sc_employees_tenant_email_uq")
      .on(t.traceyTenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check(
      "sc_employees_employment_type_chk",
      sql`${t.employmentType} in ('permanent','casual','labour_hire')`,
    ),
    check(
      "sc_employees_email_format_chk",
      sql`${t.email} is null or position('@' in ${t.email}) > 1`,
    ),
    check(
      "sc_employees_onboarding_status_chk",
      sql`${t.onboardingStatus} in ('pending','in_progress','active')`,
    ),
  ],
);

// ─── Clock events ───
//
// Append-only stream of clock punches. Each row is one transition:
//   in           — start of a work segment
//   break_start  — pause work (lunch / short break)
//   break_end    — resume work after a break
//   out          — end of work segment
//
// Derived state ("currently clocked in", "on break", "elapsed today",
// "hours this week") is computed by walking the stream — see
// apps/shiftcraft-web/lib/clock.ts. Keeping the table append-only means
// edits/corrections are themselves rows (a future slice can add
// `corrects_event_id` and `reason`) rather than mutating history.
//
// `location_id` is optional: kiosk/geofence integrations would populate
// it, but a phone-based clock-in might not know which location the user
// is at. No FK to sc_employees because clock events are keyed on
// app_user_id (the auth identity) — a labour-hire row without an auth
// user can't clock in anyway.

export const scClockEvents = pgTable(
  "sc_clock_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    // Append-only correction model: managers void a wrong punch instead
    // of mutating it. All read paths in lib/clock.ts filter voided_at IS
    // NULL so the aggregation behaves as if the row were gone. The void
    // metadata stays in the table so the audit trail is reconstructable.
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: uuid("voided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_clock_events_user_occurred_idx").on(t.appUserId, t.occurredAt),
    index("sc_clock_events_tenant_occurred_idx").on(
      t.traceyTenantId,
      t.occurredAt,
    ),
    index("sc_clock_events_user_voided_idx").on(t.appUserId, t.voidedAt),
    check(
      "sc_clock_events_type_chk",
      sql`${t.eventType} in ('in','out','break_start','break_end')`,
    ),
    check(
      "sc_clock_events_source_chk",
      sql`${t.source} in ('manual','kiosk','geofence','admin_edit')`,
    ),
  ],
);

// ─── Tasks (Kanban) ───
//
// Tenant-scoped to-do items. Mirrors the Deputy-style board: each task has
// a status that drives a column (open / in_progress / done), a priority,
// an optional assignee + location, and an optional due date. The board UI
// at /app/tasks reads the rows and groups by status — no separate
// "columns" table needed.
//
// `completed_at` is set automatically when status transitions to 'done'
// (in the action layer). Keeping it as a separate column makes
// reports/dashboard widgets cheap ("completed this week").

export const scTasks = pgTable(
  "sc_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("normal"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    locationId: uuid("location_id"),
    dueDate: date("due_date"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_tasks_tenant_status_idx").on(t.traceyTenantId, t.status),
    index("sc_tasks_assignee_idx").on(t.assigneeUserId, t.status),
    index("sc_tasks_due_idx").on(t.traceyTenantId, t.dueDate),
    check(
      "sc_tasks_status_chk",
      sql`${t.status} in ('open','in_progress','done')`,
    ),
    check(
      "sc_tasks_priority_chk",
      sql`${t.priority} in ('low','normal','high','urgent')`,
    ),
  ],
);

// ─── Announcements ───
//
// Tenant-scoped pinned messages surfaced on the dashboard. Owners/admins
// create them; everyone in the tenant reads. `pinned` controls whether
// the dashboard banner picks it up; `expires_at` lets admins set a
// "valid until" so stale messages drop off the dashboard without
// requiring a manual unpin.

export const scAnnouncements = pgTable(
  "sc_announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Email fan-out audit. `emailedAt` is set when the announcement
    // was sent as an email blast; `emailedRecipientCount` records how
    // many recipients it went to. Both null means email was not
    // requested (the announcement only surfaces in-app).
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    emailedRecipientCount: integer("emailed_recipient_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_announcements_tenant_pinned_idx").on(
      t.traceyTenantId,
      t.pinned,
      t.createdAt,
    ),
  ],
);

// ─── Timesheet approvals ───
//
// Per-(employee, week) approval ledger. No row = "pending review", which
// is the default state for any week with clock activity. A row with
// status='approved' means an admin signed off; status='disputed' means
// an admin flagged a problem (notes field carries the why).
//
// The week is keyed on `week_start` (a Monday) — single source of truth
// for which Monday-Sunday window the approval applies to. Unique on
// (tenant, employee, week_start) so re-approving the same week updates
// the existing row rather than stacking.

export const scTimesheetApprovals = pgTable(
  "sc_timesheet_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    employeeUserId: uuid("employee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: date("week_start").notNull(),
    status: text("status").notNull().default("approved"),
    notes: text("notes"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_timesheet_approvals_uq").on(
      t.traceyTenantId,
      t.employeeUserId,
      t.weekStart,
    ),
    index("sc_timesheet_approvals_tenant_week_idx").on(
      t.traceyTenantId,
      t.weekStart,
    ),
    check(
      "sc_timesheet_approvals_status_chk",
      sql`${t.status} in ('approved','disputed')`,
    ),
  ],
);

// ─── Email-notification opt-outs ───
//
// Per-(user, kind) opt-out ledger. Presence of a row = "do not email
// this user for this kind". Absence = subscribed (the default).
//
// Kept as an opt-out so brand-new accounts get every notification by
// default without us having to seed a row per tenant member at signup.
// The `kind` column is a free-text discriminator so future kinds can be
// added without a schema change; the Settings UI clamps it to a known
// list (KNOWN_EMAIL_KINDS in lib/email-prefs.ts).

export const scEmailUnsubscribes = pgTable(
  "sc_email_unsubscribes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_email_unsubscribes_uq").on(
      t.traceyTenantId,
      t.appUserId,
      t.kind,
    ),
    index("sc_email_unsubscribes_kind_idx").on(t.traceyTenantId, t.kind),
  ],
);

// ─── Shift templates ───
//
// Saved shift patterns that managers can stamp onto a specific date —
// e.g. "Saturday morning butcher 7-15 at Brunswick". Time-of-day is
// stored as separate hour/minute integers (not a full timestamp) since
// a template isn't bound to any particular day; the form on
// /app/schedule/new combines a chosen date with the template's
// time-of-day to produce the concrete startsAt/endsAt.
//
// Templates are tenant-scoped, named (unique per tenant
// case-insensitively), and linked to a location. Role is free-text so
// it matches whatever the rest of the schedule uses.

export const scShiftTemplates = pgTable(
  "sc_shift_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    locationId: uuid("location_id").notNull(),
    role: text("role").notNull(),
    startHour: integer("start_hour").notNull(),
    startMinute: integer("start_minute").notNull().default(0),
    endHour: integer("end_hour").notNull(),
    endMinute: integer("end_minute").notNull().default(0),
    defaultNotes: text("default_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_shift_templates_tenant_name_uq").on(
      t.traceyTenantId,
      sql`lower(${t.name})`,
    ),
    index("sc_shift_templates_tenant_idx").on(t.traceyTenantId),
    check(
      "sc_shift_templates_start_hour_chk",
      sql`${t.startHour} between 0 and 23`,
    ),
    check(
      "sc_shift_templates_end_hour_chk",
      sql`${t.endHour} between 0 and 23`,
    ),
    check(
      "sc_shift_templates_start_minute_chk",
      sql`${t.startMinute} in (0, 15, 30, 45)`,
    ),
    check(
      "sc_shift_templates_end_minute_chk",
      sql`${t.endMinute} in (0, 15, 30, 45)`,
    ),
  ],
);

// ─── Shift comments ───
//
// Append-only thread of notes attached to a single shift. Anyone in
// the tenant can read + post; deletion is gated to the author or an
// admin in the action layer (RLS handles tenant isolation; intra-tenant
// authorship checks aren't representable as a single policy).
//
// FK to scShifts is ON DELETE CASCADE so deleting a shift cleans up its
// thread. FK to app.users is ON DELETE SET NULL so removing a user
// keeps the comment history intact — the row just shows "Unknown" for
// the author, mirroring how audit_events handle the same case.

export const scShiftComments = pgTable(
  "sc_shift_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_shift_comments_shift_created_idx").on(t.shiftId, t.createdAt),
    index("sc_shift_comments_tenant_idx").on(t.traceyTenantId),
  ],
);

// ─── Employee PINs (kiosk auth) ───
//
// 4-digit numeric PIN per employee, hashed with bcrypt cost 12. Used by the
// on-premise kiosk to authenticate a punch (PIN replaces the email+password
// login for the kiosk surface only — kiosk auth never grants /app access).
//
// PIN uniqueness within a tenant is intentionally NOT enforced. Collisions
// are resolved at PIN-entry time by showing a disambiguation list ("Which
// one of you is it?"). Enforcing uniqueness would let an attacker enumerate
// valid PINs by exclusion.
//
// One PIN per (tenant, user). Resetting/updating overwrites. `last_used_at`
// powers the audit trail in /app/employees/[id].
export const scEmployeePins = pgTable(
  "sc_employee_pins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash").notNull(),
    setByUserId: uuid("set_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_employee_pins_tenant_user_uq").on(
      t.traceyTenantId,
      t.appUserId,
    ),
  ],
);

// ─── Kiosk devices ───
//
// A registered on-premise device (tablet / laptop) pinned to one location.
// Pairing flow: admin generates a `pairing_code` (8-char, 15-min window) at
// /app/admin/kiosks, hands it to the device which visits /kiosk/pair?code=…,
// the device exchanges the code for a long-lived HttpOnly `kiosk.device`
// cookie carrying {deviceId, tenantId, locationId} signed with
// KIOSK_DEVICE_SECRET. The pairing_code is nulled on claim (single use).
//
// `revoked_at` is a soft delete — keeps clock-event audit links intact.
// `require_selfie` controls whether the kiosk asks for a webcam photo on
// in/out punches (per-device so a webcam-less unit can still operate).
export const scKioskDevices = pgTable(
  "sc_kiosk_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    label: text("label").notNull(),
    locationId: uuid("location_id").notNull(),
    pairingCode: text("pairing_code"),
    pairingExpiresAt: timestamp("pairing_expires_at", { withTimezone: true }),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    requireSelfie: boolean("require_selfie").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_kiosk_devices_tenant_idx").on(t.traceyTenantId, t.revokedAt),
    index("sc_kiosk_devices_location_idx").on(t.locationId),
    // Pairing codes are short-lived and unique while active — enforce
    // uniqueness within a tenant so two simultaneous "Add kiosk" forms
    // can't generate colliding codes. Partial so the index doesn't bloat
    // with NULLs for already-paired devices.
    uniqueIndex("sc_kiosk_devices_pairing_uq")
      .on(t.traceyTenantId, t.pairingCode)
      .where(sql`${t.pairingCode} is not null`),
  ],
);

// ─── Clock event photos (kiosk selfies) ───
//
// One row per (clock event, photo) — exactly one per event. Image is stored
// as bytea (small: client resizes to ~320x240 JPEG q70 ≈ 15 KB). Keeping it
// in Postgres rather than S3 honours the cost-sensitivity of the Render free
// tier; if storage grows past ~100 MB per tenant the operator can migrate
// to object storage.
//
// `selfie_status` discriminates three soft-fail modes:
//   captured     — image is non-null, employee took a photo
//   denied       — required by device, but user denied camera permission
//   unavailable  — device.require_selfie = false (e.g. webcam-less kiosk)
//
// FK to sc_clock_events has ON DELETE CASCADE so deleting a clock event
// (admin correction) cleans up its photo too.
export const scClockEventPhotos = pgTable(
  "sc_clock_event_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    clockEventId: uuid("clock_event_id").notNull(),
    image: bytea("image"),
    mimeType: text("mime_type"),
    selfieStatus: text("selfie_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_clock_event_photos_event_uq").on(
      t.traceyTenantId,
      t.clockEventId,
    ),
    index("sc_clock_event_photos_tenant_idx").on(
      t.traceyTenantId,
      t.createdAt,
    ),
    check(
      "sc_clock_event_photos_status_chk",
      sql`${t.selfieStatus} in ('captured','denied','unavailable')`,
    ),
  ],
);

// ─── Employee onboarding tasks ───
//
// Per-employee checklist items spawned when an admin starts onboarding
// for a new hire. Each row is one tickable task ("Sign tax form",
// "Read handbook", etc). For first cut the task set is seeded from a
// hard-coded default list when onboarding starts — a templates surface
// can land in a later slice.
//
// `required` distinguishes hard blockers from nice-to-haves: completion
// of onboarding (status → 'active') requires every required task done;
// optional ones can stay pending without blocking the transition.

export const scEmployeeOnboardingTasks = pgTable(
  "sc_employee_onboarding_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => scEmployees.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    required: boolean("required").notNull().default(true),
    status: text("status").notNull().default("pending"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_emp_onb_tasks_employee_idx").on(t.employeeId, t.sortOrder),
    index("sc_emp_onb_tasks_tenant_idx").on(t.traceyTenantId, t.status),
    check(
      "sc_emp_onb_tasks_status_chk",
      sql`${t.status} in ('pending','done')`,
    ),
  ],
);

// ─── Documents ───
//
// People-tab document storage. Two scopes:
//   - 'library' : workspace-wide documents (handbook, policies, contract
//     templates). `employee_id` is NULL.
//   - 'team'    : per-employee documents (signed contracts, licences,
//     certifications). `employee_id` is required.
//
// Binary payload is stored as bytea — matches the existing kiosk-selfie
// pattern (sc_clock_event_photos) and works on the free Render Postgres
// tier without any external blob-storage dependency. Per-file cap is
// enforced by a CHECK constraint at 5 MiB (5 * 1024 * 1024 bytes).
//
// `expires_at` is nullable but populated for licences/certifications so
// the Team documents view can surface an "expiring soon" badge.

export const scDocuments = pgTable(
  "sc_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    scope: text("scope").notNull(),
    employeeId: uuid("employee_id").references(() => scEmployees.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    data: bytea("data").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    index("sc_documents_tenant_scope_idx").on(
      t.traceyTenantId,
      t.scope,
      t.uploadedAt,
    ),
    index("sc_documents_employee_idx").on(t.employeeId),
    index("sc_documents_tenant_expiry_idx").on(t.traceyTenantId, t.expiresAt),
    check("sc_documents_scope_chk", sql`${t.scope} in ('library','team')`),
    check(
      "sc_documents_size_chk",
      sql`${t.fileSize} > 0 and ${t.fileSize} <= 5242880`,
    ),
    check(
      "sc_documents_scope_employee_chk",
      sql`(${t.scope} = 'team' and ${t.employeeId} is not null) or (${t.scope} = 'library' and ${t.employeeId} is null)`,
    ),
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
export type ScShiftSwapRequest = typeof scShiftSwapRequests.$inferSelect;
export type NewScShiftSwapRequest = typeof scShiftSwapRequests.$inferInsert;
export type ScEmployee = typeof scEmployees.$inferSelect;
export type NewScEmployee = typeof scEmployees.$inferInsert;
export type ScEmploymentType = "permanent" | "casual" | "labour_hire";
export type ScDepartment = typeof scDepartments.$inferSelect;
export type NewScDepartment = typeof scDepartments.$inferInsert;
export type ScClockEvent = typeof scClockEvents.$inferSelect;
export type NewScClockEvent = typeof scClockEvents.$inferInsert;
export type ScClockEventType = "in" | "out" | "break_start" | "break_end";
export type ScClockEventSource = "manual" | "kiosk" | "geofence" | "admin_edit";
export type ScTask = typeof scTasks.$inferSelect;
export type NewScTask = typeof scTasks.$inferInsert;
export type ScTaskStatus = "open" | "in_progress" | "done";
export type ScTaskPriority = "low" | "normal" | "high" | "urgent";
export type ScAnnouncement = typeof scAnnouncements.$inferSelect;
export type NewScAnnouncement = typeof scAnnouncements.$inferInsert;
export type ScShiftTemplate = typeof scShiftTemplates.$inferSelect;
export type NewScShiftTemplate = typeof scShiftTemplates.$inferInsert;
export type ScShiftComment = typeof scShiftComments.$inferSelect;
export type NewScShiftComment = typeof scShiftComments.$inferInsert;
export type ScTimesheetApproval = typeof scTimesheetApprovals.$inferSelect;
export type NewScTimesheetApproval = typeof scTimesheetApprovals.$inferInsert;
export type ScTimesheetApprovalStatus = "approved" | "disputed";
export type ScShiftStatus = "draft" | "published" | "cancelled";
export type ScAssignmentStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "swapped"
  | "no_show";
export type ScTimeOffStatus = "pending" | "approved" | "denied" | "cancelled";
export type ScSwapStatus = "pending" | "accepted" | "declined" | "cancelled";
export type ScEmployeePin = typeof scEmployeePins.$inferSelect;
export type NewScEmployeePin = typeof scEmployeePins.$inferInsert;
export type ScKioskDevice = typeof scKioskDevices.$inferSelect;
export type NewScKioskDevice = typeof scKioskDevices.$inferInsert;
export type ScClockEventPhoto = typeof scClockEventPhotos.$inferSelect;
export type NewScClockEventPhoto = typeof scClockEventPhotos.$inferInsert;
export type ScSelfieStatus = "captured" | "denied" | "unavailable";
export type ScEmployeeOnboardingTask =
  typeof scEmployeeOnboardingTasks.$inferSelect;
export type NewScEmployeeOnboardingTask =
  typeof scEmployeeOnboardingTasks.$inferInsert;
export type ScOnboardingStatus = "pending" | "in_progress" | "active";
export type ScOnboardingTaskStatus = "pending" | "done";
export type ScDocument = typeof scDocuments.$inferSelect;
export type NewScDocument = typeof scDocuments.$inferInsert;
export type ScDocumentScope = "library" | "team";
