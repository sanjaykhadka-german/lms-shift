-- ShiftCraft per-tenant — award allowances + employee assignment
-- (AUDIT.md Feature 4, Fair Work integration, Slice C). Idempotent.

-- ─── sc_award_allowances ───
CREATE TABLE IF NOT EXISTS sc_award_allowances
  (LIKE public.sc_award_allowances INCLUDING ALL);

ALTER TABLE sc_award_allowances ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_award_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_award_allowances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_award_allowances;
CREATE POLICY tenant_isolation ON sc_award_allowances
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_employee_allowances ───
-- LIKE does not copy FKs, so re-attach them to the LOCAL per-tenant tables.
CREATE TABLE IF NOT EXISTS sc_employee_allowances
  (LIKE public.sc_employee_allowances INCLUDING ALL);

ALTER TABLE sc_employee_allowances ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_employee_allowances
  DROP CONSTRAINT IF EXISTS sc_employee_allowances_employee_id_fkey;
ALTER TABLE sc_employee_allowances
  ADD CONSTRAINT sc_employee_allowances_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES sc_employees(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_allowances
  DROP CONSTRAINT IF EXISTS sc_employee_allowances_allowance_id_fkey;
ALTER TABLE sc_employee_allowances
  ADD CONSTRAINT sc_employee_allowances_allowance_id_fkey
  FOREIGN KEY (allowance_id) REFERENCES sc_award_allowances(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_employee_allowances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_employee_allowances;
CREATE POLICY tenant_isolation ON sc_employee_allowances
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
