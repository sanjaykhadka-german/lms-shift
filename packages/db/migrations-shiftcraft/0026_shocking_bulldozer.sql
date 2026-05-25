-- AUDIT.md Phase 2 #13 — manager location scopes (RBAC tightening).
--
-- Public template only. Per-tenant copies created by
-- migrations/per-tenant/0038_shiftcraft_manager_locations.sql.

CREATE TABLE IF NOT EXISTS "sc_manager_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_manager_locations'
      AND constraint_name = 'sc_manager_locations_app_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_manager_locations"
      ADD CONSTRAINT "sc_manager_locations_app_user_id_users_id_fk"
      FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_manager_locations'
      AND constraint_name = 'sc_manager_locations_granted_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_manager_locations"
      ADD CONSTRAINT "sc_manager_locations_granted_by_user_id_users_id_fk"
      FOREIGN KEY ("granted_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_manager_locations_user_loc_uq" ON "sc_manager_locations" USING btree ("tracey_tenant_id","app_user_id","location_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_manager_locations_user_idx" ON "sc_manager_locations" USING btree ("tracey_tenant_id","app_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_manager_locations_location_idx" ON "sc_manager_locations" USING btree ("tracey_tenant_id","location_id");
