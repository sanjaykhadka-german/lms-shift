ALTER TABLE "sc_tenant_config" ADD COLUMN "allow_web_clock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD COLUMN "allow_unscheduled_clock_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD COLUMN "require_geofence" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD COLUMN "require_selfie" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD COLUMN "require_scheduled_shift" boolean DEFAULT false NOT NULL;