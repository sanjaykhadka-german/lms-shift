-- Public template migration. Adds scheduled break minutes to sc_shifts
-- (paid + unpaid split). Also re-asserts the sc_employees location_id /
-- position columns that drifted into the schema without a matching public
-- migration (the per-tenant copies got them via per-tenant/0046, but the
-- public template + drizzle snapshot lagged — see feedback_drizzle_journal_blind).
--
-- Fully idempotent (IF NOT EXISTS + guarded ADD CONSTRAINT) so it is safe to
-- re-run against an already-migrated public schema and so a future
-- `db:generate-shiftcraft` re-emit doesn't break.

ALTER TABLE "sc_employees" ADD COLUMN IF NOT EXISTS "location_id" uuid;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN IF NOT EXISTS "position" text;--> statement-breakpoint
ALTER TABLE "sc_shifts" ADD COLUMN IF NOT EXISTS "break_paid_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_shifts" ADD COLUMN IF NOT EXISTS "break_unpaid_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_employees_location_id_sc_locations_id_fk'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_location_id_sc_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."sc_locations"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_employees_location_idx" ON "sc_employees" USING btree ("location_id");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_shifts_break_chk'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE "sc_shifts" ADD CONSTRAINT "sc_shifts_break_chk" CHECK ("sc_shifts"."break_paid_minutes" >= 0 and "sc_shifts"."break_unpaid_minutes" >= 0);
  END IF;
END $$;
