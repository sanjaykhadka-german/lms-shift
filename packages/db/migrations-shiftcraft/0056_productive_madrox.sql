-- Weekday OT 2x ("thereafter") split — widen the earnings-mapping category
-- CHECK to allow the opt-in "overtime_double" category. Idempotent
-- (DROP IF EXISTS + re-add) so re-runs against an already-migrated public
-- schema are safe. Mirrors per-tenant migration 0069.
ALTER TABLE "sc_xero_earnings_mapping" DROP CONSTRAINT IF EXISTS "sc_xero_earnings_mapping_category_chk";--> statement-breakpoint
ALTER TABLE "sc_xero_earnings_mapping" ADD CONSTRAINT "sc_xero_earnings_mapping_category_chk" CHECK ("sc_xero_earnings_mapping"."category" in ('ordinary','overtime','overtime_double','penalty_sat','penalty_sun','penalty_ph','penalty_sat_ot','penalty_sun_ot','penalty_ph_ot','penalty_night','allowance'));