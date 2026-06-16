CREATE TABLE "sc_visitor_signins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"location_id" uuid,
	"visitor_name" text NOT NULL,
	"visitor_company" text,
	"visitor_mobile" text NOT NULL,
	"visiting_person" text NOT NULL,
	"visiting_employee_id" uuid,
	"visit_reason" text,
	"sign_in_signature" "bytea",
	"sign_out_signature" "bytea",
	"signed_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_out_at" timestamp with time zone,
	"source" text DEFAULT 'kiosk' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD CONSTRAINT "sc_visitor_signins_visiting_employee_id_sc_employees_id_fk" FOREIGN KEY ("visiting_employee_id") REFERENCES "public"."sc_employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_visitor_signins_tenant_signed_idx" ON "sc_visitor_signins" USING btree ("tracey_tenant_id","signed_in_at");--> statement-breakpoint
CREATE INDEX "sc_visitor_signins_location_signed_idx" ON "sc_visitor_signins" USING btree ("location_id","signed_in_at");