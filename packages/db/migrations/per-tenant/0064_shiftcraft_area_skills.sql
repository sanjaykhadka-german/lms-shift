-- ShiftCraft per-tenant — per-area required skills/training (items 4 & 7).
--
-- sc_area_skills is the many-to-many join: an area can require any number of
-- skills. Dragging an employee onto a shift in an area whose required skills
-- they don't all hold raises a soft "not trained for this area" warning.

CREATE TABLE IF NOT EXISTS sc_area_skills
  (LIKE public.sc_area_skills INCLUDING ALL);

ALTER TABLE sc_area_skills ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_area_skills
  DROP CONSTRAINT IF EXISTS sc_area_skills_area_id_fkey;
ALTER TABLE sc_area_skills
  ADD CONSTRAINT sc_area_skills_area_id_fkey
  FOREIGN KEY (area_id) REFERENCES sc_areas(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_area_skills
  DROP CONSTRAINT IF EXISTS sc_area_skills_skill_id_fkey;
ALTER TABLE sc_area_skills
  ADD CONSTRAINT sc_area_skills_skill_id_fkey
  FOREIGN KEY (skill_id) REFERENCES sc_skills(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_area_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_area_skills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_area_skills;
CREATE POLICY tenant_isolation ON sc_area_skills
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
