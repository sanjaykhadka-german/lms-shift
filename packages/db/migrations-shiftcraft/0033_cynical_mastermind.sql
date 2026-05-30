-- OT-on-penalty-day split (AUDIT Feature 5) — widen the earnings-mapping
-- category CHECK to allow the opt-in combo categories penalty_sat_ot /
-- penalty_sun_ot / penalty_ph_ot. Idempotent (DROP IF EXISTS + re-add) so
-- re-runs against an already-migrated public schema are safe.
ALTER TABLE "sc_xero_earnings_mapping" DROP CONSTRAINT IF EXISTS "sc_xero_earnings_mapping_category_chk";--> statement-breakpoint
ALTER TABLE "sc_xero_earnings_mapping" ADD CONSTRAINT "sc_xero_earnings_mapping_category_chk" CHECK ("sc_xero_earnings_mapping"."category" in ('ordinary','overtime','penalty_sat','penalty_sun','penalty_ph','penalty_sat_ot','penalty_sun_ot','penalty_ph_ot','penalty_night','allowance'));
