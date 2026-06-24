-- ShiftCraft per-tenant — Lead area scopes (Access levels: "Lead" tier).
--
-- Per-tenant join table between an auth user (role='lead' on the tenant
-- membership) and the areas/teams they supervise. A Lead is approve-only:
-- they view their team's schedule (read-only) and view + approve their
-- team's timesheets, scoped to exactly these areas. Empty for a given user
-- = NO access (fail-closed, same as a Location Manager with no locations).

CREATE TABLE IF NOT EXISTS sc_lead_areas
  (LIKE public.sc_lead_areas INCLUDING ALL);

ALTER TABLE sc_lead_areas ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- FK to app.users (granted_by + app_user_id both reference users).
ALTER TABLE sc_lead_areas
  DROP CONSTRAINT IF EXISTS sc_lead_areas_app_user_id_users_id_fk;
ALTER TABLE sc_lead_areas
  DROP CONSTRAINT IF EXISTS sc_lead_areas_app_user_id_fkey;
ALTER TABLE sc_lead_areas
  ADD CONSTRAINT sc_lead_areas_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_lead_areas
  DROP CONSTRAINT IF EXISTS sc_lead_areas_granted_by_user_id_users_id_fk;
ALTER TABLE sc_lead_areas
  DROP CONSTRAINT IF EXISTS sc_lead_areas_granted_by_user_id_fkey;
ALTER TABLE sc_lead_areas
  ADD CONSTRAINT sc_lead_areas_granted_by_user_id_fkey
  FOREIGN KEY (granted_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- FK to per-tenant sc_areas.
ALTER TABLE sc_lead_areas
  DROP CONSTRAINT IF EXISTS sc_lead_areas_area_id_fkey;
ALTER TABLE sc_lead_areas
  ADD CONSTRAINT sc_lead_areas_area_id_fkey
  FOREIGN KEY (area_id) REFERENCES sc_areas(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_lead_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_lead_areas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_lead_areas;
CREATE POLICY tenant_isolation ON sc_lead_areas
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
