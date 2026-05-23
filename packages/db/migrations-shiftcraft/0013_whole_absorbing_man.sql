ALTER TABLE "sc_clock_events" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sc_clock_events" ADD COLUMN "voided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "sc_clock_events" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "sc_clock_events" ADD CONSTRAINT "sc_clock_events_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_clock_events_user_voided_idx" ON "sc_clock_events" USING btree ("app_user_id","voided_at");