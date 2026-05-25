-- ShiftCraft per-tenant — skills catalogue + auto-scheduler hook (AUDIT.md #8).
--
-- Two new tables: sc_skills (per-tenant catalogue), sc_employee_skills
-- (m2m join to employees). Plus required_skill_id column on sc_shifts.

-- ─── sc_skills ───
CREATE TABLE IF NOT EXISTS sc_skills (LIKE public.sc_skills INCLUDING ALL);

ALTER TABLE sc_skills ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_skills;
CREATE POLICY tenant_isolation ON sc_skills
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_employee_skills ───
CREATE TABLE IF NOT EXISTS sc_employee_skills
  (LIKE public.sc_employee_skills INCLUDING ALL);

ALTER TABLE sc_employee_skills ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_employee_skills
  DROP CONSTRAINT IF EXISTS sc_employee_skills_employee_id_fkey;
ALTER TABLE sc_employee_skills
  ADD CONSTRAINT sc_employee_skills_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES sc_employees(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_skills
  DROP CONSTRAINT IF EXISTS sc_employee_skills_skill_id_fkey;
ALTER TABLE sc_employee_skills
  ADD CONSTRAINT sc_employee_skills_skill_id_fkey
  FOREIGN KEY (skill_id) REFERENCES sc_skills(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_employee_skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_employee_skills;
CREATE POLICY tenant_isolation ON sc_employee_skills
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_shifts.required_skill_id ───
ALTER TABLE sc_shifts
  ADD COLUMN IF NOT EXISTS required_skill_id uuid;

ALTER TABLE sc_shifts
  DROP CONSTRAINT IF EXISTS sc_shifts_required_skill_id_fkey;
ALTER TABLE sc_shifts
  ADD CONSTRAINT sc_shifts_required_skill_id_fkey
  FOREIGN KEY (required_skill_id) REFERENCES sc_skills(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;
