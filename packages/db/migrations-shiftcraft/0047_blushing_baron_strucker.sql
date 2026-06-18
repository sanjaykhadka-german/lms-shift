CREATE TABLE "sc_award_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"award_code" text NOT NULL,
	"level_code" text NOT NULL,
	"label" text NOT NULL,
	"base_hourly_rate" numeric(10, 2) NOT NULL,
	"casual_loading" numeric(5, 4),
	"effective_from" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_award_classifications_source_chk" CHECK ("sc_award_classifications"."source" in ('manual','fwc'))
);
--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "award_level_code" text;--> statement-breakpoint
ALTER TABLE "sc_tenant_config" ADD COLUMN "award_floor_block" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_award_classifications_uq" ON "sc_award_classifications" USING btree ("tracey_tenant_id","award_code","level_code","effective_from");--> statement-breakpoint
CREATE INDEX "sc_award_classifications_tenant_award_idx" ON "sc_award_classifications" USING btree ("tracey_tenant_id","award_code");