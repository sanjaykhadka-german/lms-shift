-- AUDIT.md Phase 2 #6 — leave-type catalogue + roster-clash guard.
--
-- Public template only. The per-tenant copies (where the actual data
-- lives) are created by migrations/per-tenant/0035_shiftcraft_leave_types.sql
-- via CREATE TABLE … (LIKE public.sc_leave_types INCLUDING ALL).
--
-- Made idempotent — Drizzle's journal already gates re-application, but
-- matching the per-tenant style means a manual replay against a partially
-- migrated template won't error.

CREATE TABLE IF NOT EXISTS "sc_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_leave_types_slug_chk" CHECK ("sc_leave_types"."slug" ~ '^[a-z][a-z0-9_]*$' and length("sc_leave_types"."slug") between 2 and 40),
	CONSTRAINT "sc_leave_types_name_chk" CHECK (length("sc_leave_types"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "sc_time_off_requests" ADD COLUMN IF NOT EXISTS "leave_type_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_leave_types_tenant_slug_uq" ON "sc_leave_types" USING btree ("tracey_tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_leave_types_tenant_name_uq" ON "sc_leave_types" USING btree ("tracey_tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_leave_types_tenant_idx" ON "sc_leave_types" USING btree ("tracey_tenant_id","is_archived");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_time_off_requests'
      AND constraint_name = 'sc_time_off_requests_leave_type_id_sc_leave_types_id_fk'
  ) THEN
    ALTER TABLE "sc_time_off_requests"
      ADD CONSTRAINT "sc_time_off_requests_leave_type_id_sc_leave_types_id_fk"
      FOREIGN KEY ("leave_type_id") REFERENCES "public"."sc_leave_types"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_time_off_leave_type_idx" ON "sc_time_off_requests" USING btree ("leave_type_id");
