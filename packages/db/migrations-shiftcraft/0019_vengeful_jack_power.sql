CREATE TABLE "sc_tenant_config" (
	"tracey_tenant_id" text PRIMARY KEY NOT NULL,
	"holiday_region" text DEFAULT 'national' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_tenant_config_holiday_region_chk" CHECK ("sc_tenant_config"."holiday_region" in ('national','NSW','VIC','QLD','WA','SA','TAS','ACT','NT'))
);
--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD CONSTRAINT "sc_tenant_config_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;