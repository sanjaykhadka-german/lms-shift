-- AUDIT.md Phase 2 #5 — Xero payroll adapter.
--
-- Public template only. Per-tenant copies created by
-- migrations/per-tenant/0041_shiftcraft_xero.sql.

CREATE TABLE IF NOT EXISTS "sc_xero_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"xero_tenant_id" text NOT NULL,
	"xero_tenant_name" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text,
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sc_xero_earnings_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"category" text NOT NULL,
	"xero_earnings_rate_id" text NOT NULL,
	"xero_earnings_rate_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_xero_earnings_mapping_category_chk" CHECK ("sc_xero_earnings_mapping"."category" in ('ordinary','overtime','penalty_sat','penalty_sun','penalty_ph','penalty_night','allowance'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sc_xero_employee_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"sc_employee_id" uuid NOT NULL,
	"xero_employee_id" text NOT NULL,
	"xero_employee_name" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sc_xero_pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"xero_pay_run_id" text,
	"summary" jsonb,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalised_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_xero_pay_runs_status_chk" CHECK ("sc_xero_pay_runs"."status" in ('draft','submitted','finalised','failed'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_xero_connections'
      AND constraint_name = 'sc_xero_connections_connected_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_xero_connections"
      ADD CONSTRAINT "sc_xero_connections_connected_by_user_id_users_id_fk"
      FOREIGN KEY ("connected_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_xero_pay_runs'
      AND constraint_name = 'sc_xero_pay_runs_submitted_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_xero_pay_runs"
      ADD CONSTRAINT "sc_xero_pay_runs_submitted_by_user_id_users_id_fk"
      FOREIGN KEY ("submitted_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_xero_connections_tenant_uq" ON "sc_xero_connections" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_xero_earnings_mapping_tenant_cat_uq" ON "sc_xero_earnings_mapping" USING btree ("tracey_tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_xero_employee_links_emp_uq" ON "sc_xero_employee_links" USING btree ("tracey_tenant_id","sc_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_xero_employee_links_xero_uq" ON "sc_xero_employee_links" USING btree ("tracey_tenant_id","xero_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_xero_pay_runs_tenant_week_uq" ON "sc_xero_pay_runs" USING btree ("tracey_tenant_id","week_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_xero_pay_runs_tenant_idx" ON "sc_xero_pay_runs" USING btree ("tracey_tenant_id","submitted_at");
