// LMS domain tables (training modules, quizzes, assignments, WHS records, …)
// in the default `public` schema. These are Drizzle-owned: `drizzle.config.ts`
// includes this file so the baseline migration creates them.
//
// Row-per-tenant isolation: every table carries `tracey_tenant_id uuid NOT NULL
// REFERENCES app.tenants(id)`. Queries run through `forTenant(tenantId).run()`
// which sets the `app.tenant_id` GUC; the RLS policy in
// `migrations/manual/0001_enable_rls.sql` enforces `tracey_tenant_id = the GUC`.

import {
  boolean,
  customType,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./schema";

// postgres.js returns BYTEA as Buffer; emit it the same way on insert.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const lmsUsers = pgTable("users", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  firstName: text("first_name").default(""),
  lastName: text("last_name").default(""),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("employee"),
  isActiveFlag: boolean("is_active_flag").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  phone: text("phone").default(""),
  departmentId: integer("department_id"),
  employerId: integer("employer_id"),
  startDate: date("start_date"),
  terminationDate: date("termination_date"),
  photoFilename: text("photo_filename"),
  jobTitle: text("job_title").default(""),
  managerId: integer("manager_id"),
  positionId: integer("position_id"),
  traceyUserId: text("tracey_user_id"),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

// Phase 4 Slice 3: every legacy table now carries `tracey_tenant_id`. The
// SQL migration in packages/db/migrations/manual/0003_lms_multitenant.sql
// installs both the column and a DEFAULT to LMS_ALLOWED_TENANT_ID, so
// Flask's existing INSERTs keep working without code change. Tracey
// always sets the column explicitly.

export const lmsModules = pgTable("modules", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  title: text("title").notNull(),
  description: text("description").default(""),
  createdAt: timestamp("created_at").defaultNow(),
  isPublished: boolean("is_published").default(true),
  createdById: integer("created_by_id"),
  coverPath: text("cover_path").default(""),
  validForDays: integer("valid_for_days"),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsContentItems = pgTable("content_items", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").default(""),
  filePath: text("file_path").default(""),
  position: integer("position").default(0),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsContentItemMedia = pgTable("content_item_media", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  contentItemId: integer("content_item_id").notNull(),
  filePath: text("file_path").notNull(),
  kind: text("kind").default(""),
  position: integer("position").default(0),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsModuleMedia = pgTable("module_media", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  filePath: text("file_path").notNull(),
  kind: text("kind").default(""),
  position: integer("position").default(0),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsQuestions = pgTable("questions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  prompt: text("prompt").notNull(),
  kind: text("kind").default("single"),
  position: integer("position").default(0),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsChoices = pgTable("choices", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  questionId: integer("question_id").notNull(),
  text: text("text").notNull(),
  isCorrect: boolean("is_correct").default(false),
  position: integer("position").default(0),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsAssignments = pgTable("assignments", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  userId: integer("user_id").notNull(),
  moduleId: integer("module_id").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow(),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  versionId: integer("version_id"),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsModuleVersions = pgTable("module_versions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  moduleId: integer("module_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  // Flask stores this as TEXT (db.Text), parse with JSON.parse in TS.
  snapshotJson: text("snapshot_json").notNull(),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  summary: text("summary").default(""),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsAttempts = pgTable("attempts", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  userId: integer("user_id").notNull(),
  moduleId: integer("module_id").notNull(),
  score: integer("score").default(0),
  correct: integer("correct").default(0),
  total: integer("total").default(0),
  passed: boolean("passed").default(false),
  answersJson: text("answers_json").default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsDepartments = pgTable("departments", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsEmployers = pgTable("employers", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsMachines = pgTable("machines", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  departmentId: integer("department_id"),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsPositions = pgTable("positions", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  departmentId: integer("department_id"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsUserMachines = pgTable(
  "user_machines",
  {
    userId: integer("user_id").notNull(),
    machineId: integer("machine_id").notNull(),
    traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.machineId] })],
);

export const lmsMachineModules = pgTable(
  "machine_modules",
  {
    machineId: integer("machine_id").notNull(),
    moduleId: integer("module_id").notNull(),
    traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.moduleId] })],
);

export const lmsDepartmentModulePolicies = pgTable("department_module_policies", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  departmentId: integer("department_id").notNull(),
  moduleId: integer("module_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsWhsRecords = pgTable("whs_records", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  kind: text("kind").notNull(),
  userId: integer("user_id"),
  title: text("title").notNull(),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),
  notes: text("notes").default(""),
  documentFilename: text("document_filename"),
  lastRemindedAt: timestamp("last_reminded_at"),
  incidentDate: date("incident_date"),
  severity: text("severity"),
  reportedById: integer("reported_by_id"),
  createdAt: timestamp("created_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

// Per-tenant taxonomy for WHS record kinds. Slug stays as the value written
// into whs_records.kind (text, no FK) so historic records survive deletion of
// their kind. `category` drives the form's conditional fields (expiry vs
// incident block); `is_system` marks the four seeded rows that can't be
// deleted by admins.
export const lmsWhsKinds = pgTable("whs_kinds", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  slug: text("slug").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsAuditLogs = pgTable("audit_logs", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  userId: integer("user_id"),
  actorEmail: text("actor_email").default(""),
  actorName: text("actor_name").default(""),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  summary: text("summary").default(""),
  detailsJson: text("details_json").default(""),
  ipAddress: text("ip_address").default(""),
  userAgent: text("user_agent").default(""),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const lmsUploadedFiles = pgTable("uploaded_files", {
  filename: text("filename").primaryKey(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  data: bytea("data").notNull(),
  size: integer("size").default(0),
  uploadedById: integer("uploaded_by_id"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  traceyTenantId: uuid("tracey_tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export type LmsUser = typeof lmsUsers.$inferSelect;
export type NewLmsUser = typeof lmsUsers.$inferInsert;
export type LmsDepartment = typeof lmsDepartments.$inferSelect;
export type LmsEmployer = typeof lmsEmployers.$inferSelect;
export type LmsMachine = typeof lmsMachines.$inferSelect;
export type LmsWhsRecord = typeof lmsWhsRecords.$inferSelect;
export type NewLmsWhsRecord = typeof lmsWhsRecords.$inferInsert;
export type LmsWhsKind = typeof lmsWhsKinds.$inferSelect;
export type NewLmsWhsKind = typeof lmsWhsKinds.$inferInsert;
export type LmsAuditLog = typeof lmsAuditLogs.$inferSelect;
export type LmsPosition = typeof lmsPositions.$inferSelect;
export type LmsModule = typeof lmsModules.$inferSelect;
export type LmsContentItem = typeof lmsContentItems.$inferSelect;
export type LmsContentItemMedia = typeof lmsContentItemMedia.$inferSelect;
export type LmsModuleMedia = typeof lmsModuleMedia.$inferSelect;
export type LmsQuestion = typeof lmsQuestions.$inferSelect;
export type LmsChoice = typeof lmsChoices.$inferSelect;
export type LmsAssignment = typeof lmsAssignments.$inferSelect;
export type NewLmsAssignment = typeof lmsAssignments.$inferInsert;
export type LmsModuleVersion = typeof lmsModuleVersions.$inferSelect;
export type LmsAttempt = typeof lmsAttempts.$inferSelect;
export type NewLmsAttempt = typeof lmsAttempts.$inferInsert;
