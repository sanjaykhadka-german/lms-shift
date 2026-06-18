CREATE TABLE "sc_award_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"award_code" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(10, 4) NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_award_allowances_type_chk" CHECK ("sc_award_allowances"."type" in ('flat','per_hour','per_shift','per_day')),
	CONSTRAINT "sc_award_allowances_source_chk" CHECK ("sc_award_allowances"."source" in ('manual','fwc'))
);
--> statement-breakpoint
CREATE TABLE "sc_employee_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"allowance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sc_employee_allowances" ADD CONSTRAINT "sc_employee_allowances_employee_id_sc_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."sc_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_employee_allowances" ADD CONSTRAINT "sc_employee_allowances_allowance_id_sc_award_allowances_id_fk" FOREIGN KEY ("allowance_id") REFERENCES "public"."sc_award_allowances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sc_award_allowances_uq" ON "sc_award_allowances" USING btree ("tracey_tenant_id","award_code","key","effective_from");--> statement-breakpoint
CREATE INDEX "sc_award_allowances_tenant_award_idx" ON "sc_award_allowances" USING btree ("tracey_tenant_id","award_code");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_employee_allowances_uq" ON "sc_employee_allowances" USING btree ("tracey_tenant_id","employee_id","allowance_id");--> statement-breakpoint
CREATE INDEX "sc_employee_allowances_emp_idx" ON "sc_employee_allowances" USING btree ("tracey_tenant_id","employee_id");