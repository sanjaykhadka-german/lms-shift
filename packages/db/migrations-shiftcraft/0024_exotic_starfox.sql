-- AUDIT.md Phase 2 #9 — sc_daily_sales for wages-vs-sales reporting.
--
-- Public template only. Per-tenant copies live in tenant schemas; see
-- migrations/per-tenant/0036_shiftcraft_daily_sales.sql for the per-tenant
-- shape with RLS + tenant default.
--
-- Idempotent — Drizzle journal already gates re-application, but matching
-- the rest of the repo's pattern keeps manual replays safe.

CREATE TABLE IF NOT EXISTS "sc_daily_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"gross_sales" numeric(12, 2) NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_daily_sales_gross_chk" CHECK ("sc_daily_sales"."gross_sales" >= 0)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_daily_sales'
      AND constraint_name = 'sc_daily_sales_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_daily_sales"
      ADD CONSTRAINT "sc_daily_sales_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_daily_sales'
      AND constraint_name = 'sc_daily_sales_updated_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_daily_sales"
      ADD CONSTRAINT "sc_daily_sales_updated_by_user_id_users_id_fk"
      FOREIGN KEY ("updated_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_daily_sales_tenant_loc_date_uq" ON "sc_daily_sales" USING btree ("tracey_tenant_id","location_id","business_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_daily_sales_tenant_date_idx" ON "sc_daily_sales" USING btree ("tracey_tenant_id","business_date");
