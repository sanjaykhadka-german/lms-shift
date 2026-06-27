CREATE TABLE "sc_xero_leave_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"sc_leave_type_id" uuid NOT NULL,
	"xero_leave_type_id" text NOT NULL,
	"xero_leave_type_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_time_off_requests" ADD COLUMN "xero_leave_application_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_xero_leave_mapping_tenant_lt_uq" ON "sc_xero_leave_mapping" USING btree ("tracey_tenant_id","sc_leave_type_id");