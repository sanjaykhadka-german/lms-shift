CREATE TABLE "sc_timesheet_day_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"notes" text,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_timesheet_day_approvals_status_chk" CHECK ("sc_timesheet_day_approvals"."status" in ('approved','disputed'))
);
--> statement-breakpoint
ALTER TABLE "sc_timesheet_day_approvals" ADD CONSTRAINT "sc_timesheet_day_approvals_employee_user_id_users_id_fk" FOREIGN KEY ("employee_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_timesheet_day_approvals" ADD CONSTRAINT "sc_timesheet_day_approvals_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_timesheet_day_approvals_uq" ON "sc_timesheet_day_approvals" USING btree ("tracey_tenant_id","employee_user_id","work_date");--> statement-breakpoint
CREATE INDEX "sc_timesheet_day_approvals_tenant_date_idx" ON "sc_timesheet_day_approvals" USING btree ("tracey_tenant_id","work_date");