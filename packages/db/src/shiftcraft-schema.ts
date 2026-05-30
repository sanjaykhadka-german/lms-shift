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
  doublePrecision,
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
    // Geofence config (Phase 2 #7a). All three are optional; setting a
    // radius without lat/lng — or vice versa — silently disables
    // geofence for this location. The mobile clock surface walks the
    // tenant's locations, computes Haversine distance to each that has
    // all three set, and picks the nearest one within its radius.
    // Range checks (-90..90, -180..180, radius positive) enforced in
    // the admin save action; we don't add a CHECK so future global
    // tooling can write rows without the form layer.
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geofenceRadiusM: integer("geofence_radius_m"),
    // Wage-budget guardrail (Phase 2 #2 / AUDIT Feature 2). Optional
    // daily labour-cost ceiling for this site, in AUD. Null = no budget
    // set (guardrail inactive — schedule + auto-fill behave as before).
    // Compared against projected scheduled wages per calendar day
    // (shift hours × accepted employee's hourly rate). A single daily
    // figure applies to every weekday for v1; per-weekday budgets are a
    // documented future refinement.
    dailyWageBudget: numeric("daily_wage_budget", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sc_locations_tenant_idx").on(t.traceyTenantId),
    check("sc_locations_timezone_chk", sql`length(${t.timezone}) > 0`),
    check(
      "sc_locations_color_chk",
      sql`${t.color} is null or ${t.color} ~* '^#[0-9a-f]{6}$'`,
    ),
    check(
      "sc_locations_daily_wage_budget_chk",
      sql`${t.dailyWageBudget} is null or ${t.dailyWageBudget} >= 0`,
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
    // AUDIT.md #8 — required skill for the auto-scheduler. Null = no
    // requirement (any candidate is acceptable; the role text is
    // descriptive but not enforced). FK to per-tenant sc_skills is
    // attached in the per-tenant migration; nullable on purpose so
    // existing shifts back-fill cleanly.
    requiredSkillId: uuid("required_skill_id"),
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

// ─── Leave types (AUDIT.md Phase 2 #6) ───
//
// Per-tenant catalogue of leave categories that a time-off request can
// belong to. Replaces the previous free-text `reason` discriminator on
// sc_time_off_requests with a typed FK so reports and accrual logic
// (later slice) have a stable grouping.
//
// `slug` is the stable machine key used by the seeded defaults
// ('annual', 'personal_sick', 'unpaid', 'long_service', 'other') so app
// code can look up "the tenant's annual-leave type" without hard-coding
// a UUID. Admins can rename `name` freely; `slug` is immutable for
// seeded rows (UI hides the slug field on those). Custom types created
// via the admin page get a slug derived from the name on insert.
//
// `is_archived` is a soft-delete — leaving the row in place keeps
// historical sc_time_off_requests rows pointing at a valid catalogue
// entry. The admin UI filters archived rows out of the request form
// dropdown but still surfaces them on the management page so admins
// can un-archive.

export const scLeaveTypes = pgTable(
  "sc_leave_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    // Hours of leave accrued per hour of ordinary work. Null = no
    // accrual (Unpaid, Other). AU general-rule defaults seeded on
    // first migration: annual = 4/52 ≈ 0.076923, personal_sick =
    // 2/52 ≈ 0.038462. Long service starts at 0 (state-dependent;
    // admin enters when ready). Casual employees get 0 accrual
    // regardless of this rate — the computation in
    // lib/leave-balances.ts gates on `employment_type` before
    // applying the rate.
    accrualRatePerHour: numeric("accrual_rate_per_hour", {
      precision: 8,
      scale: 6,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_leave_types_tenant_slug_uq").on(t.traceyTenantId, t.slug),
    uniqueIndex("sc_leave_types_tenant_name_uq").on(
      t.traceyTenantId,
      sql`lower(${t.name})`,
    ),
    index("sc_leave_types_tenant_idx").on(t.traceyTenantId, t.isArchived),
    check(
      "sc_leave_types_slug_chk",
      sql`${t.slug} ~ '^[a-z][a-z0-9_]*$' and length(${t.slug}) between 2 and 40`,
    ),
    check(
      "sc_leave_types_name_chk",
      sql`length(${t.name}) between 1 and 80`,
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
    // FK to sc_leave_types (AUDIT.md #6). Per the schema-wide pattern
    // for FKs between sc_* tables, the per-tenant migration re-attaches
    // this constraint pointing at the per-tenant copy of sc_leave_types
    // — the public-template version is declared via Drizzle so codegen
    // emits the column, but the runtime constraint is owned by SQL.
    leaveTypeId: uuid("leave_type_id").references(() => scLeaveTypes.id, {
      onDelete: "restrict",
    }),
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
    index("sc_time_off_leave_type_idx").on(t.leaveTypeId),
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
// contractor staff who never need a login still appear on the roster.
// Full-time / part-time / casual employees can be linked to their auth
// user (app_user_id) when they have one — for example after
// self-onboarding or when the LMS admin confirms the suggested learner
// record.
//
// `email` is nullable because contractor rows often have only a name +
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
    // Employment vocabulary aligned with the AU brief (migration 0034
    // renamed the legacy `permanent`/`labour_hire` values):
    //   full_time | part_time : ongoing employees, accrue leave, join the
    //                           training cohort, auto-invited to log in.
    //   casual                : variable hours, zero leave accrual
    //                           (loading is in the rate), still invited.
    //   contractor            : roster-only / external. No leave accrual,
    //                           no LMS suggestion, never auto-invited.
    employmentType: text("employment_type").notNull().default("full_time"),
    // Hourly wage in tenant currency. Nullable so contractor / casual
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
    // Personal details surfaced by the employee profile modal. All
    // nullable so existing rows back-fill cleanly. Edited via the
    // existing /app/employees/[id]/edit form, displayed read-only in the
    // detail modal on /app/people/team.
    preferredName: text("preferred_name"),
    gender: text("gender"),
    dateOfBirth: date("date_of_birth"),
    addressLine: text("address_line"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    // Per-employee award profile override (Phase 2 #3b.6). Same jsonb
    // shape as sc_tenant_config.award_profile — set only the fields that
    // differ from the tenant profile. Resolution chain: employee →
    // tenant → @tracey/award defaults. Null means "inherit from
    // tenant" (which itself may be null → inherit from package).
    awardProfile: jsonb("award_profile"),
    // Payroll PII. Encrypted at rest via the @tracey/db `pii` helper
    // (AES-256-GCM, TRACEY_PII_ENC_KEY). Stored as v1:base64 tokens.
    // - tfn_enc                : AU Tax File Number
    // - bsb_enc                : Bank-State-Branch (6-digit routing)
    // - account_number_enc     : Bank account number
    // - super_fund_name        : Super fund choice — NOT encrypted; the
    //                            fund name on its own is not PII
    // - super_member_number_enc: Member number within that fund
    // Never select these in list endpoints; reveal only via a server
    // action that writes a `shiftcraft.employee.pii_revealed` audit event.
    tfnEnc: text("tfn_enc"),
    bsbEnc: text("bsb_enc"),
    accountNumberEnc: text("account_number_enc"),
    superFundName: text("super_fund_name"),
    superMemberNumberEnc: text("super_member_number_enc"),
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
      sql`${t.employmentType} in ('full_time','part_time','casual','contractor')`,
    ),
    check(
      "sc_employees_email_format_chk",
      sql`${t.email} is null or position('@' in ${t.email}) > 1`,
    ),
    check(
      "sc_employees_onboarding_status_chk",
      sql`${t.onboardingStatus} in ('pending','in_progress','active')`,
    ),
    check(
      "sc_employees_gender_chk",
      sql`${t.gender} is null or ${t.gender} in ('female','male','non_binary','prefer_not_to_say')`,
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
// app_user_id (the auth identity) — a contractor row without an auth
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
    // E-sign flag (AUDIT.md Phase 2 #2c). Only meaningful for scope=team
    // — set by the uploader to indicate the assigned employee must sign
    // before the document is considered acknowledged. Signatures live in
    // sc_document_signatures keyed by (document_id, signer_app_user_id).
    // Enforced application-side (toggle action requires team scope) so
    // we don't need a DB constraint that locks library docs out forever.
    requiresSignature: boolean("requires_signature").notNull().default(false),
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

// ─── Document signatures (AUDIT.md Phase 2 #2c) ───
//
// Append-only audit record of every e-signature event on a sc_documents
// row. A row here is the legal-evidence artifact:
//
//   - WHO signed:     signer_app_user_id (+ denormalised email/name)
//   - WHAT they typed: signature_text — the typed name from the UI
//   - WHEN:           signed_at (server clock, UTC)
//   - WHERE FROM:     signer_ip, signer_user_agent (best-effort headers)
//   - PROOF OF DOC:   source_document_hash — SHA-256 of sc_documents.data
//                     at sign time. If the source is later mutated, the
//                     hash mismatch proves it. (We deliberately don't try
//                     to render a "signed PDF" — that's a follow-up slice
//                     gated on a PDF lib decision.)
//
// One row per (document, signer). Re-signing isn't allowed in v1 — the
// unique index below blocks it. If a re-sign is needed (admin uploads a
// new version), delete the old document and upload a fresh one.

export const scDocumentSignatures = pgTable(
  "sc_document_signatures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => scDocuments.id, { onDelete: "cascade" }),
    signerAppUserId: uuid("signer_app_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    signerEmail: text("signer_email").notNull(),
    signerFullName: text("signer_full_name").notNull(),
    signatureText: text("signature_text").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    signerIp: text("signer_ip"),
    signerUserAgent: text("signer_user_agent"),
    sourceDocumentHash: text("source_document_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_document_signatures_document_idx").on(t.documentId),
    index("sc_document_signatures_tenant_signed_idx").on(
      t.traceyTenantId,
      t.signedAt,
    ),
    // One signature per (document, signer). Partial index — covers the
    // common case where the signer has an auth user; legacy rows where
    // signer_app_user_id is later null (user deleted) are excluded so the
    // historical evidence isn't blocked by a constraint.
    uniqueIndex("sc_document_signatures_document_signer_uq")
      .on(t.documentId, t.signerAppUserId)
      .where(sql`${t.signerAppUserId} is not null`),
    check(
      "sc_document_signatures_text_chk",
      sql`length(${t.signatureText}) between 2 and 200`,
    ),
    check(
      "sc_document_signatures_hash_chk",
      sql`length(${t.sourceDocumentHash}) = 64`,
    ),
  ],
);

// ─── Tenant config (AUDIT.md Phase 2 #3a) ────────────────────────────
//
// Workspace-level settings, one row per tenant. v1 only carries the AU
// holiday-calendar region — but we use a dedicated table (not a column
// on app.tenants) so future workspace prefs land here without touching
// the cross-app shared registry. Lazy-created: callers read with a
// default fallback to "national", the upsert path creates the row on
// first save.
//
// Region vocabulary is pinned by a CHECK constraint: {national, NSW,
// VIC, QLD, WA, SA, TAS, ACT, NT}. The literal "national" sentinel
// (rather than NULL) keeps `where region in ('national', $tenant)`
// trivial and dodges the NULL-not-equal trap in unique-index semantics.

export const scTenantConfig = pgTable(
  "sc_tenant_config",
  {
    traceyTenantId: text("tracey_tenant_id").primaryKey(),
    holidayRegion: text("holiday_region").notNull().default("national"),
    // Award profile overrides for the @tracey/award classifier (Phase 2
    // #3b.5). JSONB so partial overrides are cheap and the shape can
    // evolve without DDL. Null/empty object = use AU general-rule
    // defaults from @tracey/award. The validated shape lives in
    // lib/timesheet-classifier.ts (AwardProfileOverrides).
    awardProfile: jsonb("award_profile"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "sc_tenant_config_holiday_region_chk",
      sql`${t.holidayRegion} in ('national','NSW','VIC','QLD','WA','SA','TAS','ACT','NT')`,
    ),
  ],
);

// ─── Daily sales (AUDIT.md Phase 2 #9) ─────────────────────────────
//
// One row per (location, business date). Manually entered by admins
// at /app/admin/daily-sales; the wages-vs-sales card on /app/reports
// joins these against the award-classifier-derived labour cost for
// the same week.
//
// `gross_sales` is the tenant-currency revenue total for the day —
// before tax handling decisions; the report shows it as-entered and
// notes "as keyed in" so admins know we don't reconcile against a
// POS feed. POS integration is explicitly deferred (per AUDIT.md
// scope clarification: v1 uses manual daily sales entry).
//
// Unique on (tenant, location, business_date) — re-saving the same
// day overwrites the prior row instead of stacking.

export const scDailySales = pgTable(
  "sc_daily_sales",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    locationId: uuid("location_id").notNull(),
    businessDate: date("business_date").notNull(),
    // 12 digits / 2 decimals supports up to $99 999 999 999.99 — well
    // beyond any single-day-per-location reasonable cap. Stored in
    // tenant currency (assumed AUD per Phase 2 scope).
    grossSales: numeric("gross_sales", { precision: 12, scale: 2 }).notNull(),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_daily_sales_tenant_loc_date_uq").on(
      t.traceyTenantId,
      t.locationId,
      t.businessDate,
    ),
    index("sc_daily_sales_tenant_date_idx").on(
      t.traceyTenantId,
      t.businessDate,
    ),
    check("sc_daily_sales_gross_chk", sql`${t.grossSales} >= 0`),
  ],
);

// ─── Xero payroll integration (AUDIT.md #5) ─────────────────────────
//
// Four tables, one Xero org per tenant. Pattern mirrors Deputy's
// integration:
//
//   sc_xero_connections        — OAuth tokens (AES-256-GCM at rest)
//   sc_xero_earnings_mapping   — internal category → Xero earnings rate
//   sc_xero_employee_links     — sc_employees.id → Xero employee uuid
//   sc_xero_pay_runs           — export ledger: one row per (tenant,
//                                 week) submission; idempotent via the
//                                 unique index.
//
// Tokens never leave the server. Refresh happens in lib/payroll/xero.ts
// at request time; the access token is short-lived (30min) and
// re-issued via the long-lived refresh token. Hard rule from AUDIT.md:
// ShiftCraft NEVER calculates tax/super/payslips — Xero owns that.

export const scXeroConnections = pgTable(
  "sc_xero_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    // The Xero tenant id (org uuid Xero uses to scope API calls).
    // Distinct from `tracey_tenant_id`. Returned by Xero's
    // `/connections` endpoint after consent.
    xeroTenantId: text("xero_tenant_id").notNull(),
    xeroTenantName: text("xero_tenant_name"),
    // PII-encrypted tokens. Use @tracey/db/pii encrypt/decrypt at
    // read/write time. Never select on a list endpoint.
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }).notNull(),
    scopes: text("scopes"),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One Xero connection per tenant. Re-connecting overwrites the
    // existing row rather than stacking; the upsert is keyed on the
    // tenant_id alone (Xero org id can change if the user reconnects
    // to a different org).
    uniqueIndex("sc_xero_connections_tenant_uq").on(t.traceyTenantId),
  ],
);

// Category vocabulary the timesheet classifier emits:
//   ordinary       — base hours at base rate
//   overtime       — 1.5x or 2x band
//   penalty_sat    — Saturday penalty rate
//   penalty_sun    — Sunday penalty rate
//   penalty_ph     — Public holiday penalty rate
//   penalty_night  — Late-night / early-morning penalty
//   allowance      — flat allowances (per-shift or per-hour)
//
// Tenants map each to a Xero EarningsRate id. If an export needs a
// category the tenant hasn't mapped, the action returns an error
// listing the missing categories — same friendly error shape as the
// earnings-rate config UI.

export const scXeroEarningsMapping = pgTable(
  "sc_xero_earnings_mapping",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    category: text("category").notNull(),
    xeroEarningsRateId: text("xero_earnings_rate_id").notNull(),
    // Denormalised for the UI — saves a Xero round-trip just to
    // render the mapping table.
    xeroEarningsRateName: text("xero_earnings_rate_name"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_xero_earnings_mapping_tenant_cat_uq").on(
      t.traceyTenantId,
      t.category,
    ),
    check(
      "sc_xero_earnings_mapping_category_chk",
      sql`${t.category} in ('ordinary','overtime','penalty_sat','penalty_sun','penalty_ph','penalty_sat_ot','penalty_sun_ot','penalty_ph_ot','penalty_night','allowance')`,
    ),
  ],
);

export const scXeroEmployeeLinks = pgTable(
  "sc_xero_employee_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    scEmployeeId: uuid("sc_employee_id").notNull(),
    xeroEmployeeId: text("xero_employee_id").notNull(),
    // Denormalised name at link time for the admin UI; refreshed on
    // next list operation.
    xeroEmployeeName: text("xero_employee_name"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_xero_employee_links_emp_uq").on(
      t.traceyTenantId,
      t.scEmployeeId,
    ),
    uniqueIndex("sc_xero_employee_links_xero_uq").on(
      t.traceyTenantId,
      t.xeroEmployeeId,
    ),
  ],
);

// Pay-run export ledger. One row per (tenant, week) submission. The
// xeroPayRunId is null until Xero accepts the draft POST; on read-back
// the summary jsonb fills with per-employee gross/net pulled from the
// finalised pay run.
//
// Idempotent on (tenant, week_start) — re-export of an already-submitted
// week is a no-op + reuses the existing xeroPayRunId for read-back.

export const scXeroPayRuns = pgTable(
  "sc_xero_pay_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    weekStart: date("week_start").notNull(),
    status: text("status").notNull().default("draft"),
    xeroPayRunId: text("xero_pay_run_id"),
    summary: jsonb("summary"),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finalisedAt: timestamp("finalised_at", { withTimezone: true }),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_xero_pay_runs_tenant_week_uq").on(
      t.traceyTenantId,
      t.weekStart,
    ),
    index("sc_xero_pay_runs_tenant_idx").on(t.traceyTenantId, t.submittedAt),
    check(
      "sc_xero_pay_runs_status_chk",
      sql`${t.status} in ('draft','submitted','finalised','failed')`,
    ),
  ],
);

// ─── Skills + employee skills (AUDIT.md #8 auto-scheduler) ──────────
//
// Per-tenant skill catalogue. A skill is a free-text label
// (e.g. "Butchering", "Cashier", "RSA"). Slug derived from name on
// insert; same pattern as sc_leave_types — admins can rename freely
// while the slug stays stable.
//
// sc_employee_skills is the many-to-many join: an employee can carry
// any number of skills. The auto-scheduler uses this set to filter
// candidates against a shift's required_skill_id.

export const scSkills = pgTable(
  "sc_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_skills_tenant_slug_uq").on(t.traceyTenantId, t.slug),
    uniqueIndex("sc_skills_tenant_name_uq").on(
      t.traceyTenantId,
      sql`lower(${t.name})`,
    ),
    index("sc_skills_tenant_idx").on(t.traceyTenantId, t.isArchived),
    check(
      "sc_skills_slug_chk",
      sql`${t.slug} ~ '^[a-z][a-z0-9_]*$' and length(${t.slug}) between 2 and 40`,
    ),
    check(
      "sc_skills_name_chk",
      sql`length(${t.name}) between 1 and 80`,
    ),
  ],
);

export const scEmployeeSkills = pgTable(
  "sc_employee_skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    skillId: uuid("skill_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_employee_skills_uq").on(
      t.traceyTenantId,
      t.employeeId,
      t.skillId,
    ),
    index("sc_employee_skills_employee_idx").on(
      t.traceyTenantId,
      t.employeeId,
    ),
    index("sc_employee_skills_skill_idx").on(t.traceyTenantId, t.skillId),
  ],
);

// ─── Web push subscriptions (AUDIT.md #12) ──────────────────────────
//
// One row per (user, browser endpoint). A single user can have many —
// laptop browser, mobile browser, etc. The endpoint URL is the
// service-provider's unique handle for that browser instance; we
// upsert on (tenant, user, endpoint) so re-subscribing from the same
// browser replaces the keys rather than stacking duplicates.
//
// p256dh + auth are the ECDH public key + auth secret from the
// browser's PushSubscription. Stored as the URL-safe base64 strings
// the web-push library expects on the wire (matches how the browser
// exports them via subscription.toJSON()).
//
// When a delivery returns 410 Gone / 404 (the browser revoked its
// subscription), the helper at lib/web-push.ts deletes the matching
// row so the next fan-out skips it.

export const scPushSubscriptions = pgTable(
  "sc_push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_push_subs_tenant_user_endpoint_uq").on(
      t.traceyTenantId,
      t.appUserId,
      t.endpoint,
    ),
    index("sc_push_subs_user_idx").on(t.traceyTenantId, t.appUserId),
  ],
);

// ─── Manager location scopes (AUDIT.md #13) ─────────────────────────
//
// Per-tenant assignment of an admin (role='admin' on the tenant
// membership) to one or more specific locations. Owners always see
// every location, no rows needed. Admins WITHOUT any rows here keep
// full cross-location access — backwards-compat for tenants that
// don't need location partitioning. Admins WITH 1+ rows are scoped
// to exactly that subset; queries on schedule / timesheets /
// coverage-gaps filter by locationId IN (scope).
//
// Rationale for choosing a side table over a column on `members`:
// the membership row lives in the shared `app` schema and is reused
// by other apps (LMS, planning), so encoding ShiftCraft-specific
// location semantics there would leak ShiftCraft concepts upstream.
// A per-tenant sc_* table keeps the scoping local + RLS-isolated.

export const scManagerLocations = pgTable(
  "sc_manager_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sc_manager_locations_user_loc_uq").on(
      t.traceyTenantId,
      t.appUserId,
      t.locationId,
    ),
    index("sc_manager_locations_user_idx").on(t.traceyTenantId, t.appUserId),
    index("sc_manager_locations_location_idx").on(
      t.traceyTenantId,
      t.locationId,
    ),
  ],
);

// ─── Outbound webhook subscriptions (AUDIT.md #10) ──────────────────
//
// One row per (tenant, event, target URL). Receivers register a URL +
// a long random secret; on every matching event we POST the JSON
// payload with an X-Webhook-Signature: sha256=<hex> header, the hex
// being HMAC-SHA256(secret, raw body). Standard pattern (GitHub /
// Stripe / etc.) — receivers verify the header to defend against
// replay + spoofing.
//
// `event` is plain text rather than a Postgres enum so adding a new
// event in code doesn't require DDL. The set of recognised events is
// curated in lib/webhooks.ts; rows with unknown event strings simply
// never fire (the emit helper filters by the lookup at send time).
//
// `is_active` is a soft pause — receivers can be temporarily silenced
// during an integration migration without losing the secret / URL.
//
// `last_success_at` / `last_failure_at` are denormalised for the
// admin page's at-a-glance health column; the canonical history lives
// in sc_webhook_deliveries.

export const scWebhookSubscriptions = pgTable(
  "sc_webhook_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    event: text("event").notNull(),
    url: text("url").notNull(),
    // Secret is stored as-is. Treated as sensitive — never returned
    // in list queries unless the caller explicitly opts in via a
    // reveal action that writes an audit event.
    secret: text("secret").notNull(),
    label: text("label"),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_webhook_subs_tenant_event_idx").on(
      t.traceyTenantId,
      t.event,
      t.isActive,
    ),
    check(
      "sc_webhook_subs_url_chk",
      sql`${t.url} ~* '^https?://'`,
    ),
    check(
      "sc_webhook_subs_event_chk",
      sql`length(${t.event}) between 1 and 80`,
    ),
    check(
      "sc_webhook_subs_secret_chk",
      sql`length(${t.secret}) >= 16`,
    ),
  ],
);

// ─── Outbound webhook deliveries (AUDIT.md #10) ─────────────────────
//
// Append-only log of every delivery attempt. One row per (subscription,
// emit). Status flow: pending -> succeeded | failed. Retries don't
// insert a new row — they re-fire the existing one and bump
// attempt_count + last_attempted_at + last_error.
//
// `payload` is the JSON body as-sent. Kept verbatim so an operator can
// re-post the exact same body on retry without re-deriving it from app
// state (which may have drifted by then).
//
// `response_body_excerpt` is truncated to 1000 chars — receivers
// occasionally dump megabytes of error HTML; storing the lot would
// bloat the table for little debugging value.

export const scWebhookDeliveries = pgTable(
  "sc_webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    traceyTenantId: text("tracey_tenant_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    requestSentAt: timestamp("request_sent_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBodyExcerpt: text("response_body_excerpt"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sc_webhook_deliveries_tenant_idx").on(
      t.traceyTenantId,
      t.createdAt,
    ),
    index("sc_webhook_deliveries_sub_idx").on(
      t.subscriptionId,
      t.createdAt,
    ),
    index("sc_webhook_deliveries_status_idx").on(
      t.traceyTenantId,
      t.status,
      t.createdAt,
    ),
    check(
      "sc_webhook_deliveries_status_chk",
      sql`${t.status} in ('pending','succeeded','failed')`,
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
export type ScLeaveType = typeof scLeaveTypes.$inferSelect;
export type NewScLeaveType = typeof scLeaveTypes.$inferInsert;
// Stable machine keys for the seeded defaults. Custom types created via
// the admin page get derived slugs that are *not* in this union — code
// should treat this as a string with these well-known values, not as a
// closed set.
export type ScSeededLeaveSlug =
  | "annual"
  | "personal_sick"
  | "unpaid"
  | "long_service"
  | "other";
export type ScTimeOffRequest = typeof scTimeOffRequests.$inferSelect;
export type NewScTimeOffRequest = typeof scTimeOffRequests.$inferInsert;
export type ScShiftSwapRequest = typeof scShiftSwapRequests.$inferSelect;
export type NewScShiftSwapRequest = typeof scShiftSwapRequests.$inferInsert;
export type ScEmployee = typeof scEmployees.$inferSelect;
export type NewScEmployee = typeof scEmployees.$inferInsert;
export type ScEmploymentType =
  | "full_time"
  | "part_time"
  | "casual"
  | "contractor";
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
export type ScDocumentSignature = typeof scDocumentSignatures.$inferSelect;
export type NewScDocumentSignature = typeof scDocumentSignatures.$inferInsert;
export type ScTenantConfig = typeof scTenantConfig.$inferSelect;
export type NewScTenantConfig = typeof scTenantConfig.$inferInsert;
export type ScHolidayRegion =
  | "national"
  | "NSW"
  | "VIC"
  | "QLD"
  | "WA"
  | "SA"
  | "TAS"
  | "ACT"
  | "NT";
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
export type ScDailySale = typeof scDailySales.$inferSelect;
export type NewScDailySale = typeof scDailySales.$inferInsert;
export type ScWebhookSubscription = typeof scWebhookSubscriptions.$inferSelect;
export type NewScWebhookSubscription = typeof scWebhookSubscriptions.$inferInsert;
export type ScWebhookDelivery = typeof scWebhookDeliveries.$inferSelect;
export type NewScWebhookDelivery = typeof scWebhookDeliveries.$inferInsert;
export type ScWebhookDeliveryStatus = "pending" | "succeeded" | "failed";
export type ScManagerLocation = typeof scManagerLocations.$inferSelect;
export type NewScManagerLocation = typeof scManagerLocations.$inferInsert;
export type ScPushSubscription = typeof scPushSubscriptions.$inferSelect;
export type NewScPushSubscription = typeof scPushSubscriptions.$inferInsert;
export type ScSkill = typeof scSkills.$inferSelect;
export type NewScSkill = typeof scSkills.$inferInsert;
export type ScEmployeeSkill = typeof scEmployeeSkills.$inferSelect;
export type NewScEmployeeSkill = typeof scEmployeeSkills.$inferInsert;
export type ScXeroConnection = typeof scXeroConnections.$inferSelect;
export type NewScXeroConnection = typeof scXeroConnections.$inferInsert;
export type ScXeroEarningsMapping = typeof scXeroEarningsMapping.$inferSelect;
export type NewScXeroEarningsMapping = typeof scXeroEarningsMapping.$inferInsert;
export type ScXeroEmployeeLink = typeof scXeroEmployeeLinks.$inferSelect;
export type NewScXeroEmployeeLink = typeof scXeroEmployeeLinks.$inferInsert;
export type ScXeroPayRun = typeof scXeroPayRuns.$inferSelect;
export type NewScXeroPayRun = typeof scXeroPayRuns.$inferInsert;
export type ScXeroPayRunStatus = "draft" | "submitted" | "finalised" | "failed";
export type ScPayrollCategory =
  | "ordinary"
  | "overtime"
  | "penalty_sat"
  | "penalty_sun"
  | "penalty_ph"
  // Opt-in combo categories: overtime worked ON a penalty day. Only used
  // by the Xero export when the admin has mapped them to a Xero earnings
  // rate — otherwise that OT folds into the base penalty bucket (the
  // pre-existing behaviour), so adding these never breaks an export.
  | "penalty_sat_ot"
  | "penalty_sun_ot"
  | "penalty_ph_ot"
  | "penalty_night"
  | "allowance";
