CREATE TABLE "sc_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_areas_color_chk" CHECK ("sc_areas"."color" is null or "sc_areas"."color" ~* '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sc_areas_location_name_uq" ON "sc_areas" USING btree ("location_id",lower("name"));--> statement-breakpoint
CREATE INDEX "sc_areas_tenant_idx" ON "sc_areas" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE INDEX "sc_areas_location_idx" ON "sc_areas" USING btree ("location_id");