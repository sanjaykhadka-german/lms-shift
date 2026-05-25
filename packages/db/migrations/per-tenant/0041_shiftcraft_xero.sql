-- ShiftCraft per-tenant — Xero payroll adapter (AUDIT.md #5).
--
-- Four tables for the Xero integration. Tokens in sc_xero_connections
-- are AES-256-GCM encrypted at rest via @tracey/db/pii.

-- ─── sc_xero_connections ───
CREATE TABLE IF NOT EXISTS sc_xero_connections
  (LIKE public.sc_xero_connections INCLUDING ALL);

ALTER TABLE sc_xero_connections ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_xero_connections
  DROP CONSTRAINT IF EXISTS sc_xero_connections_connected_by_user_id_users_id_fk;
ALTER TABLE sc_xero_connections
  DROP CONSTRAINT IF EXISTS sc_xero_connections_connected_by_user_id_fkey;
ALTER TABLE sc_xero_connections
  ADD CONSTRAINT sc_xero_connections_connected_by_user_id_fkey
  FOREIGN KEY (connected_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_xero_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_xero_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_xero_connections;
CREATE POLICY tenant_isolation ON sc_xero_connections
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_xero_earnings_mapping ───
CREATE TABLE IF NOT EXISTS sc_xero_earnings_mapping
  (LIKE public.sc_xero_earnings_mapping INCLUDING ALL);

ALTER TABLE sc_xero_earnings_mapping ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_xero_earnings_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_xero_earnings_mapping FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_xero_earnings_mapping;
CREATE POLICY tenant_isolation ON sc_xero_earnings_mapping
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_xero_employee_links ───
CREATE TABLE IF NOT EXISTS sc_xero_employee_links
  (LIKE public.sc_xero_employee_links INCLUDING ALL);

ALTER TABLE sc_xero_employee_links ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_xero_employee_links
  DROP CONSTRAINT IF EXISTS sc_xero_employee_links_sc_employee_id_fkey;
ALTER TABLE sc_xero_employee_links
  ADD CONSTRAINT sc_xero_employee_links_sc_employee_id_fkey
  FOREIGN KEY (sc_employee_id) REFERENCES sc_employees(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_xero_employee_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_xero_employee_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_xero_employee_links;
CREATE POLICY tenant_isolation ON sc_xero_employee_links
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_xero_pay_runs ───
CREATE TABLE IF NOT EXISTS sc_xero_pay_runs
  (LIKE public.sc_xero_pay_runs INCLUDING ALL);

ALTER TABLE sc_xero_pay_runs ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_xero_pay_runs
  DROP CONSTRAINT IF EXISTS sc_xero_pay_runs_submitted_by_user_id_users_id_fk;
ALTER TABLE sc_xero_pay_runs
  DROP CONSTRAINT IF EXISTS sc_xero_pay_runs_submitted_by_user_id_fkey;
ALTER TABLE sc_xero_pay_runs
  ADD CONSTRAINT sc_xero_pay_runs_submitted_by_user_id_fkey
  FOREIGN KEY (submitted_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_xero_pay_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_xero_pay_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_xero_pay_runs;
CREATE POLICY tenant_isolation ON sc_xero_pay_runs
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
