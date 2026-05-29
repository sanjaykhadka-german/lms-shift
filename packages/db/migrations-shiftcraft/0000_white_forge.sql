CREATE TABLE "sc_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_locations_timezone_chk" CHECK (length("sc_locations"."timezone") > 0)
);
--> statement-breakpoint
CREATE TABLE "sc_shift_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_assignments_status_chk" CHECK ("sc_shift_assignments"."status" in ('offered','accepted','declined','swapped','no_show'))
);
--> statement-breakpoint
CREATE TABLE "sc_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"role" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_shifts_status_chk" CHECK ("sc_shifts"."status" in ('draft','published','cancelled')),
	CONSTRAINT "sc_shifts_time_chk" CHECK ("sc_shifts"."ends_at" > "sc_shifts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "sc_time_off_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_time_off_status_chk" CHECK ("sc_time_off_requests"."status" in ('pending','approved','denied','cancelled')),
	CONSTRAINT "sc_time_off_dates_chk" CHECK ("sc_time_off_requests"."end_date" >= "sc_time_off_requests"."start_date")
);
--> statement-breakpoint
ALTER TABLE "sc_shift_assignments" ADD CONSTRAINT "sc_shift_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_shifts" ADD CONSTRAINT "sc_shifts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_time_off_requests" ADD CONSTRAINT "sc_time_off_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_time_off_requests" ADD CONSTRAINT "sc_time_off_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_locations_tenant_idx" ON "sc_locations" USING btree ("tracey_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_shift_user_uq" ON "sc_shift_assignments" USING btree ("shift_id","user_id");--> statement-breakpoint
CREATE INDEX "sc_assignments_user_idx" ON "sc_shift_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sc_shifts_tenant_starts_idx" ON "sc_shifts" USING btree ("tracey_tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "sc_shifts_location_starts_idx" ON "sc_shifts" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "sc_time_off_tenant_idx" ON "sc_time_off_requests" USING btree ("tracey_tenant_id","start_date");--> statement-breakpoint
CREATE INDEX "sc_time_off_user_idx" ON "sc_time_off_requests" USING btree ("user_id","start_date");