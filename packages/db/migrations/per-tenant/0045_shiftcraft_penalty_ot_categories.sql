-- ShiftCraft per-tenant — widen sc_xero_earnings_mapping category CHECK
-- for the OT-on-penalty-day split (AUDIT Feature 5).
--
-- Adds three opt-in combo categories — penalty_sat_ot / penalty_sun_ot /
-- penalty_ph_ot — so admins can (optionally) map overtime worked on a
-- penalty day to its own Xero earnings rate. When left unmapped, the
-- export folds that OT into the base penalty bucket exactly as before, so
-- this migration is purely permissive: it never changes existing rows or
-- export behaviour on its own.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-add, so re-runs against an
-- already-migrated tenant schema are safe.

ALTER TABLE sc_xero_earnings_mapping
  DROP CONSTRAINT IF EXISTS sc_xero_earnings_mapping_category_chk;

ALTER TABLE sc_xero_earnings_mapping
  ADD CONSTRAINT sc_xero_earnings_mapping_category_chk
    CHECK (category IN (
      'ordinary','overtime',
      'penalty_sat','penalty_sun','penalty_ph',
      'penalty_sat_ot','penalty_sun_ot','penalty_ph_ot',
      'penalty_night','allowance'
    ));
