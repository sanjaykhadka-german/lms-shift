-- ShiftCraft per-tenant — award classifications + minimum-rate floor
-- (AUDIT.md Feature 4, Fair Work integration, Slice B). Idempotent.

-- ─── sc_award_classifications ───
CREATE TABLE IF NOT EXISTS sc_award_classifications
  (LIKE public.sc_award_classifications INCLUDING ALL);

ALTER TABLE sc_award_classifications ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_award_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_award_classifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_award_classifications;
CREATE POLICY tenant_isolation ON sc_award_classifications
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── Employee classification link + floor-enforcement toggle ───
ALTER TABLE sc_employees ADD COLUMN IF NOT EXISTS award_level_code text;
ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS award_floor_block boolean NOT NULL DEFAULT false;
