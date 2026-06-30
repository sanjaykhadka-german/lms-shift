-- ShiftCraft per-tenant — widen sc_xero_earnings_mapping category CHECK
-- for the weekday OT 2x ("thereafter") split.
--
-- Adds one opt-in category — overtime_double — so admins can (optionally)
-- map the double-time OT band to its own Xero earnings rate (e.g. an
-- "OT (Mon-Fri) THEREAFTER" rate). When left unmapped, the export folds
-- that band into the base "overtime" bucket exactly as before, so this
-- migration is purely permissive: it never changes existing rows or
-- export behaviour on its own.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-add, so re-runs against an
-- already-migrated tenant schema are safe.

ALTER TABLE sc_xero_earnings_mapping
  DROP CONSTRAINT IF EXISTS sc_xero_earnings_mapping_category_chk;

ALTER TABLE sc_xero_earnings_mapping
  ADD CONSTRAINT sc_xero_earnings_mapping_category_chk
    CHECK (category IN (
      'ordinary','overtime','overtime_double',
      'penalty_sat','penalty_sun','penalty_ph',
      'penalty_sat_ot','penalty_sun_ot','penalty_ph_ot',
      'penalty_night','allowance'
    ));
