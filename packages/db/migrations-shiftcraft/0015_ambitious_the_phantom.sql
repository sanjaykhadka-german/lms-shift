CREATE TABLE "sc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"scope" text NOT NULL,
	"employee_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by_user_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "sc_documents_scope_chk" CHECK ("sc_documents"."scope" in ('library','team')),
	CONSTRAINT "sc_documents_size_chk" CHECK ("sc_documents"."file_size" > 0 and "sc_documents"."file_size" <= 5242880),
	CONSTRAINT "sc_documents_scope_employee_chk" CHECK (("sc_documents"."scope" = 'team' and "sc_documents"."employee_id" is not null) or ("sc_documents"."scope" = 'library' and "sc_documents"."employee_id" is null))
);
--> statement-breakpoint
ALTER TABLE "sc_documents" ADD CONSTRAINT "sc_documents_employee_id_sc_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."sc_employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_documents" ADD CONSTRAINT "sc_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_documents_tenant_scope_idx" ON "sc_documents" USING btree ("tracey_tenant_id","scope","uploaded_at");--> statement-breakpoint
CREATE INDEX "sc_documents_employee_idx" ON "sc_documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "sc_documents_tenant_expiry_idx" ON "sc_documents" USING btree ("tracey_tenant_id","expires_at");