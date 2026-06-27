-- ShiftCraft per-tenant — Xero leave push (Slice 2).
--
-- 1. sc_xero_leave_mapping: maps a tenant leave type (sc_leave_types) to a Xero
--    Payroll-AU leave type, mirroring sc_xero_earnings_mapping. Created from the
--    public template via LIKE; FK to the per-tenant sc_leave_types re-attached
--    here (the template column is a bare uuid). RLS + tenant_isolation as per
--    every sc_* table.
-- 2. sc_time_off_requests.xero_leave_application_id: idempotency marker so an
--    approved request is pushed to Xero at most once.
--
-- Public template gains both via migrate-shiftcraft 0055 (runs first). Idempotent.

-- ─── sc_xero_leave_mapping ───
CREATE TABLE IF NOT EXISTS sc_xero_leave_mapping
  (LIKE public.sc_xero_leave_mapping INCLUDING ALL);

ALTER TABLE sc_xero_leave_mapping ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_xero_leave_mapping
  DROP CONSTRAINT IF EXISTS sc_xero_leave_mapping_sc_leave_type_id_fkey;
ALTER TABLE sc_xero_leave_mapping
  ADD CONSTRAINT sc_xero_leave_mapping_sc_leave_type_id_fkey
  FOREIGN KEY (sc_leave_type_id) REFERENCES sc_leave_types(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_xero_leave_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_xero_leave_mapping FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_xero_leave_mapping;
CREATE POLICY tenant_isolation ON sc_xero_leave_mapping
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_time_off_requests.xero_leave_application_id ───
ALTER TABLE sc_time_off_requests
  ADD COLUMN IF NOT EXISTS xero_leave_application_id text;
