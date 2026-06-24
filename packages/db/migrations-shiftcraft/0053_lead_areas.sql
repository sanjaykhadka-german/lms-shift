CREATE TABLE "sc_lead_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_lead_areas" ADD CONSTRAINT "sc_lead_areas_app_user_id_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_lead_areas" ADD CONSTRAINT "sc_lead_areas_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_lead_areas_user_area_uq" ON "sc_lead_areas" USING btree ("tracey_tenant_id","app_user_id","area_id");--> statement-breakpoint
CREATE INDEX "sc_lead_areas_user_idx" ON "sc_lead_areas" USING btree ("tracey_tenant_id","app_user_id");--> statement-breakpoint
CREATE INDEX "sc_lead_areas_area_idx" ON "sc_lead_areas" USING btree ("tracey_tenant_id","area_id");