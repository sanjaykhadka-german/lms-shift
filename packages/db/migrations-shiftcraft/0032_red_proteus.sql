-- Wage-budget guardrail (AUDIT Feature 2) — optional daily labour-cost
-- ceiling per location, in AUD. Made idempotent (IF NOT EXISTS + drop-then-add
-- on the CHECK) so re-runs against an already-migrated public schema are safe.
ALTER TABLE "sc_locations" ADD COLUMN IF NOT EXISTS "daily_wage_budget" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "sc_locations" DROP CONSTRAINT IF EXISTS "sc_locations_daily_wage_budget_chk";--> statement-breakpoint
ALTER TABLE "sc_locations" ADD CONSTRAINT "sc_locations_daily_wage_budget_chk" CHECK ("sc_locations"."daily_wage_budget" is null or "sc_locations"."daily_wage_budget" >= 0);
