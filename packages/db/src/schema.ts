import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

// ─── Profile table (mirrors Supabase auth.users) ───
//
// Authentication is owned by Supabase Auth (the `auth.users` table in the
// reserved `auth` schema). This `app.users` row is the application-side
// profile, keyed by the SAME uuid as the Supabase auth user — so `id` is
// supplied by Supabase on sign-up (no defaultRandom). Every domain FK that
// references a user (members.userId, tenants.ownerUserId, sc_shifts.created_by,
// …) points here. A row is upserted on the user's first authenticated request
// (see each app's getOrProvisionProfile()).

export const users = appSchema.table("users", {
  id: uuid("id").primaryKey(), // === auth.users.id (Supabase-supplied)
  name: text("name"),
  email: text("email").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

// ─── Tenant / billing tables ───

export interface AuditModeSettings {
  hideUnpublishedModules: boolean;
  hideIncompleteAssignments: boolean;
  hideFailedAttempts: boolean;
  hideInactiveEmployees: boolean;
  hideExpiredWhs: boolean;
  hideAuditOnlyRoutes: boolean;
}

export const AUDIT_MODE_DEFAULTS: AuditModeSettings = {
  hideUnpublishedModules: true,
  hideIncompleteAssignments: true,
  hideFailedAttempts: true,
  hideInactiveEmployees: true,
  hideExpiredWhs: true,
  hideAuditOnlyRoutes: true,
};

export const tenants = appSchema.table(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("free"),
    status: text("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    seatsPurchased: integer("seats_purchased").notNull().default(0),
    timezone: text("timezone").notNull().default("Australia/Sydney"),
    auditMode: boolean("audit_mode").notNull().default(false),
    auditModeSettings: jsonb("audit_mode_settings")
      .$type<AuditModeSettings>()
      .notNull()
      .default(AUDIT_MODE_DEFAULTS),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_slug_uq").on(t.slug),
    uniqueIndex("tenants_stripe_customer_id_uq").on(t.stripeCustomerId),
    uniqueIndex("tenants_stripe_subscription_id_uq").on(t.stripeSubscriptionId),
    check("tenants_plan_chk", sql`${t.plan} in ('free','starter','pro','enterprise')`),
    check(
      "tenants_status_chk",
      sql`${t.status} in ('trialing','active','past_due','canceled')`,
    ),
    check("tenants_timezone_chk", sql`length(${t.timezone}) > 0`),
  ],
);

// ─── Organization membership ───

export const members = appSchema.table(
  "members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_tenant_user_uq").on(t.tenantId, t.userId),
    check("members_role_chk", sql`${t.role} in ('owner','admin','member')`),
  ],
);

export const invitations = appSchema.table(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.token),
    check("invitations_role_chk", sql`${t.role} in ('owner','admin','member')`),
  ],
);

// ─── Stripe webhook idempotency ───

export const processedStripeEvents = appSchema.table("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Audit log ───
//
// Append-only record of sensitive events: tenant.created, invitation.created,
// invitation.revoked, member.joined, subscription.changed. Surfaced in the
// platform-admin UI; never directly mutated outside logAuditEvent().
//
// tenantId / actorUserId are nullable + ON DELETE SET NULL so removing a
// tenant or user doesn't cascade-destroy their audit history. actorEmail is
// denormalized for the same reason — the row stays meaningful after the user
// row is gone.

export const auditEvents = appSchema.table(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetId: text("target_id"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_events_action_idx").on(t.action),
  ],
);

// ─── AI Studio sessions ───
//
// Per-(user, tenant) ephemeral state for the AI Studio chat: history, uploaded
// file references, and the latest AI-generated module JSON. Wiped on /reset.
// Mirrors what Flask kept in the cookie session at session["ai_studio"].

export const aiStudioSessions = appSchema.table(
  "ai_studio_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    history: jsonb("history").notNull().default(sql`'[]'::jsonb`),
    files: jsonb("files").notNull().default(sql`'[]'::jsonb`),
    currentModuleJson: text("current_module_json"),
    moduleId: integer("module_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ai_studio_sessions_user_tenant_uq").on(t.userId, t.tenantId)],
);

// ─── In-app notifications ───
//
// Per-user, per-tenant inbox surfaced as the bell dropdown in the app header.
// Lives in `app` schema (not the per-tenant LMS schema) because it references
// `users` (auth) directly via UUID, mirroring `audit_events`. Tenant scoping
// is enforced in code via `tenantId` filter, not RLS.

export const notifications = appSchema.table(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    actionUrl: text("action_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_created_idx").on(
      t.recipientUserId,
      t.tenantId,
      t.createdAt,
    ),
    index("notifications_recipient_unread_idx").on(t.recipientUserId, t.readAt),
  ],
);

// ─── Inferred types ───

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type ProcessedStripeEvent = typeof processedStripeEvents.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type Role = "owner" | "admin" | "member";
export type AiStudioSession = typeof aiStudioSessions.$inferSelect;
export type NewAiStudioSession = typeof aiStudioSessions.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
