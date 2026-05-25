-- AUDIT.md Phase 2 #8 — skills catalogue + auto-scheduler scaffolding.
--
-- Public template only. Per-tenant copies created by
-- migrations/per-tenant/0040_shiftcraft_skills.sql.

CREATE TABLE IF NOT EXISTS "sc_employee_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sc_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_skills_slug_chk" CHECK ("sc_skills"."slug" ~ '^[a-z][a-z0-9_]*$' and length("sc_skills"."slug") between 2 and 40),
	CONSTRAINT "sc_skills_name_chk" CHECK (length("sc_skills"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "sc_shifts" ADD COLUMN IF NOT EXISTS "required_skill_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_employee_skills_uq" ON "sc_employee_skills" USING btree ("tracey_tenant_id","employee_id","skill_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_employee_skills_employee_idx" ON "sc_employee_skills" USING btree ("tracey_tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_employee_skills_skill_idx" ON "sc_employee_skills" USING btree ("tracey_tenant_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_skills_tenant_slug_uq" ON "sc_skills" USING btree ("tracey_tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_skills_tenant_name_uq" ON "sc_skills" USING btree ("tracey_tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_skills_tenant_idx" ON "sc_skills" USING btree ("tracey_tenant_id","is_archived");
