-- ShiftCraft per-tenant — sc_visitor_signins (reception visitor logbook).
--
-- A visitor signs in on arrival (insert) and out on departure (update).
-- Visitors are NOT app users; identity is the free-text name/company/mobile
-- they enter at the kiosk. visiting_employee_id optionally links to a local
-- sc_employees row (host on staff); visiting_person always carries the typed
-- name. Signatures stored as PNG bytea, like kiosk selfies.
--
-- Idempotent: IF NOT EXISTS + DROP/ADD on the FK so re-runs on
-- partially-migrated tenants are safe.

CREATE TABLE IF NOT EXISTS sc_visitor_signins
  (LIKE public.sc_visitor_signins INCLUDING ALL);

ALTER TABLE sc_visitor_signins ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- Re-attach the host FK to the per-tenant copy of sc_employees (the public
-- template target is replaced by the local one). ON DELETE SET NULL: if the
-- linked employee is later removed, the visit record stays — visiting_person
-- preserves who they came to see.
ALTER TABLE sc_visitor_signins
  DROP CONSTRAINT IF EXISTS sc_visitor_signins_visiting_employee_id_fkey;
ALTER TABLE sc_visitor_signins
  DROP CONSTRAINT IF EXISTS sc_visitor_signins_visiting_employee_id_sc_employees_id_fk;
ALTER TABLE sc_visitor_signins
  ADD CONSTRAINT sc_visitor_signins_visiting_employee_id_fkey
  FOREIGN KEY (visiting_employee_id) REFERENCES sc_employees(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_visitor_signins ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_visitor_signins FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_visitor_signins;
CREATE POLICY tenant_isolation ON sc_visitor_signins
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
