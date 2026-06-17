import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

// ─── Auth.js standard tables (Drizzle adapter required schema) ───
//
// We use the JWT session strategy, so the `sessions` table is rarely written
// to, but the @auth/drizzle-adapter still expects it to exist.

export const users = appSchema.table("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"), // bcrypt hash; null for OAuth-only users
  // Bumped to NOW() on every password reset/change. JWTs minted before this
  // timestamp are revoked at the next requireUser() call.
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const accounts = appSchema.table(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = appSchema.table("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = appSchema.table(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ─── Tenant / billing tables ───

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

// ─── Per-app subscriptions ───
//
// One row per (tenant, app). Each app in the Tracey suite (lms, shiftcraft)
// is billed independently: its own Stripe subscription, plan, status, trial,
// and period. A tenant shares ONE Stripe customer across its apps, so
// stripe_customer_id repeats across a tenant's rows; stripe_subscription_id
// is unique per row.
//
// This supersedes the billing columns historically held directly on
// `tenants` (plan/status/trial_ends_at/…). Those columns are retained during
// the transition and backfilled into an app='lms' row here; they are dropped
// only in a later, explicitly-triggered cleanup once every read/write path
// has moved to this table.
export const tenantSubscriptions = appSchema.table(
  "tenant_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    plan: text("plan").notNull().default("free"),
    status: text("status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    seatsPurchased: integer("seats_purchased").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_subscriptions_tenant_app_uq").on(t.tenantId, t.app),
    uniqueIndex("tenant_subscriptions_stripe_subscription_id_uq").on(
      t.stripeSubscriptionId,
    ),
    index("tenant_subscriptions_stripe_customer_id_ix").on(t.stripeCustomerId),
    check("tenant_subscriptions_app_chk", sql`${t.app} in ('lms','shiftcraft')`),
    check(
      "tenant_subscriptions_plan_chk",
      sql`${t.plan} in ('free','starter','pro','enterprise')`,
    ),
    check(
      "tenant_subscriptions_status_chk",
      sql`${t.status} in ('trialing','active','past_due','canceled')`,
    ),
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
    check(
      "members_role_chk",
      sql`${t.role} in ('owner','admin','location_manager','member')`,
    ),
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
    check(
      "invitations_role_chk",
      sql`${t.role} in ('owner','admin','location_manager','member')`,
    ),
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
export type Role = "owner" | "admin" | "location_manager" | "member";
export type AiStudioSession = typeof aiStudioSessions.$inferSelect;
export type NewAiStudioSession = typeof aiStudioSessions.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
