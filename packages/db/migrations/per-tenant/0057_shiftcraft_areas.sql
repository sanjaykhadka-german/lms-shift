-- ShiftCraft per-tenant — sc_areas (Deputy-style scheduling Areas per Location).
--
-- An Area is a scheduling subdivision within a Location. Shifts continue to
-- store the area name denormalised in sc_shifts.role; sc_areas is the managed
-- vocabulary the New-shift form + bulk-copy pick from. Backfills one area per
-- distinct (location_id, role) already on sc_shifts so nothing existing is lost.

-- 1. New table from the public template (LIKE doesn't copy FKs; added below).
CREATE TABLE IF NOT EXISTS sc_areas (LIKE public.sc_areas INCLUDING ALL);

-- 2. Tenant default + RLS.
ALTER TABLE sc_areas ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_areas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_areas;
CREATE POLICY tenant_isolation ON sc_areas
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- 3. Backfill: one area per distinct (location_id, role) on existing shifts.
--    role is NOT NULL on sc_shifts; the trim(role) <> '' guard skips any
--    blank legacy rows. Case-insensitive dedupe via the unique index.
INSERT INTO sc_areas (tracey_tenant_id, location_id, name)
SELECT DISTINCT
  current_setting('app.tenant_id', true),
  location_id,
  trim(role)
FROM sc_shifts
WHERE role IS NOT NULL
  AND trim(role) <> ''
ON CONFLICT (location_id, lower(name)) DO NOTHING;

-- 4. FK on location_id, pointing at the per-tenant sc_locations. Deleting a
--    location removes its areas (the vocabulary); existing shifts keep their
--    role text regardless.
ALTER TABLE sc_areas
  ADD CONSTRAINT sc_areas_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
