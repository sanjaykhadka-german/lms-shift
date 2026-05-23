CREATE TABLE "sc_employee_onboarding_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_emp_onb_tasks_status_chk" CHECK ("sc_employee_onboarding_tasks"."status" in ('pending','done'))
);
--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "onboarding_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "onboarding_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sc_employee_onboarding_tasks" ADD CONSTRAINT "sc_employee_onboarding_tasks_employee_id_sc_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."sc_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_employee_onboarding_tasks" ADD CONSTRAINT "sc_employee_onboarding_tasks_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_emp_onb_tasks_employee_idx" ON "sc_employee_onboarding_tasks" USING btree ("employee_id","sort_order");--> statement-breakpoint
CREATE INDEX "sc_emp_onb_tasks_tenant_idx" ON "sc_employee_onboarding_tasks" USING btree ("tracey_tenant_id","status");--> statement-breakpoint
CREATE INDEX "sc_employees_onboarding_idx" ON "sc_employees" USING btree ("tracey_tenant_id","onboarding_status");--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_onboarding_status_chk" CHECK ("sc_employees"."onboarding_status" in ('pending','in_progress','active'));