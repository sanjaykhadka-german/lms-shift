CREATE TABLE "sc_area_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sc_area_skills_uq" ON "sc_area_skills" USING btree ("tracey_tenant_id","area_id","skill_id");--> statement-breakpoint
CREATE INDEX "sc_area_skills_area_idx" ON "sc_area_skills" USING btree ("tracey_tenant_id","area_id");--> statement-breakpoint
CREATE INDEX "sc_area_skills_skill_idx" ON "sc_area_skills" USING btree ("tracey_tenant_id","skill_id");