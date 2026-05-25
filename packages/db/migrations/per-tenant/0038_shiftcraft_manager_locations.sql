-- ShiftCraft per-tenant — manager location scopes (AUDIT.md #13).
--
-- Per-tenant join table between an admin auth user and the
-- locations they manage. Empty for a given user = full cross-
-- location access (backwards-compat). 1+ rows = scoped.

CREATE TABLE IF NOT EXISTS sc_manager_locations
  (LIKE public.sc_manager_locations INCLUDING ALL);

ALTER TABLE sc_manager_locations ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- FK to app.users (granted_by + app_user_id both reference users).
ALTER TABLE sc_manager_locations
  DROP CONSTRAINT IF EXISTS sc_manager_locations_app_user_id_users_id_fk;
ALTER TABLE sc_manager_locations
  DROP CONSTRAINT IF EXISTS sc_manager_locations_app_user_id_fkey;
ALTER TABLE sc_manager_locations
  ADD CONSTRAINT sc_manager_locations_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_manager_locations
  DROP CONSTRAINT IF EXISTS sc_manager_locations_granted_by_user_id_users_id_fk;
ALTER TABLE sc_manager_locations
  DROP CONSTRAINT IF EXISTS sc_manager_locations_granted_by_user_id_fkey;
ALTER TABLE sc_manager_locations
  ADD CONSTRAINT sc_manager_locations_granted_by_user_id_fkey
  FOREIGN KEY (granted_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- FK to per-tenant sc_locations.
ALTER TABLE sc_manager_locations
  DROP CONSTRAINT IF EXISTS sc_manager_locations_location_id_fkey;
ALTER TABLE sc_manager_locations
  ADD CONSTRAINT sc_manager_locations_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_manager_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_manager_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_manager_locations;
CREATE POLICY tenant_isolation ON sc_manager_locations
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
