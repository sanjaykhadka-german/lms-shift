-- ShiftCraft per-tenant — sc_documents (People > Document library + Team
-- documents).
--
-- Stores binary file payloads as bytea (same pattern as
-- sc_clock_event_photos). Two scopes:
--   - 'library' : workspace-wide documents; employee_id IS NULL
--   - 'team'    : per-employee documents; employee_id NOT NULL
--
-- A CHECK constraint enforces a 5 MiB cap per file (same number the
-- upload action validates against). Re-attaching FKs to per-tenant
-- sc_employees keeps the CASCADE deletion behavior consistent with the
-- public template.

CREATE TABLE IF NOT EXISTS sc_documents
  (LIKE public.sc_documents INCLUDING ALL);

ALTER TABLE sc_documents ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE CASCADE: removing an employee wipes their per-employee
-- documents. Library-scope rows have employee_id IS NULL so they're
-- unaffected.
ALTER TABLE sc_documents
  DROP CONSTRAINT IF EXISTS sc_documents_employee_id_fkey;
ALTER TABLE sc_documents
  ADD CONSTRAINT sc_documents_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES sc_employees(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ON DELETE SET NULL: audit trail survives the uploader being removed
-- from the tenant.
ALTER TABLE sc_documents
  DROP CONSTRAINT IF EXISTS sc_documents_uploaded_by_user_id_fkey;
ALTER TABLE sc_documents
  ADD CONSTRAINT sc_documents_uploaded_by_user_id_fkey
  FOREIGN KEY (uploaded_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_documents;
CREATE POLICY tenant_isolation ON sc_documents
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
