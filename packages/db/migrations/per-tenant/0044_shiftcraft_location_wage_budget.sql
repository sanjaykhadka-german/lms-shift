-- ShiftCraft per-tenant — sc_locations daily wage-budget column
-- (AUDIT Feature 2, wage-budget guardrail).
--
-- Optional daily labour-cost ceiling for the site, in AUD. Nullable so
-- existing rows back-fill cleanly; a location only triggers the
-- guardrail (schedule budget chips + auto-fill rejection) once a value
-- is set. A single daily figure applies to every weekday in v1.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + drop-then-add on the CHECK so
-- re-runs against an already-migrated tenant schema are safe.

ALTER TABLE sc_locations
  ADD COLUMN IF NOT EXISTS daily_wage_budget numeric(10, 2);

ALTER TABLE sc_locations
  DROP CONSTRAINT IF EXISTS sc_locations_daily_wage_budget_chk;

ALTER TABLE sc_locations
  ADD CONSTRAINT sc_locations_daily_wage_budget_chk
    CHECK (daily_wage_budget IS NULL OR daily_wage_budget >= 0);
