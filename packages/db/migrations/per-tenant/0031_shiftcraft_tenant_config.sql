-- ShiftCraft per-tenant — sc_tenant_config (AUDIT.md Phase 2 #3a).
--
-- Workspace-level settings, one row per tenant. v1 holds only the AU
-- holiday-calendar region (national | NSW | VIC | QLD | WA | SA | TAS |
-- ACT | NT). Lazy-created: callers read with a default fallback to
-- "national"; the upsert path creates the row on first save.
--
-- Pattern mirrors migrations/per-tenant/0027_shiftcraft_documents.sql —
-- copy the public template structure into the tenant schema, re-attach
-- the FK against the cross-schema app.users target, enable RLS.
--
-- Idempotent: IF NOT EXISTS + DROP/ADD on constraints so re-runs on
-- partially-migrated tenants are safe.

CREATE TABLE IF NOT EXISTS sc_tenant_config
  (LIKE public.sc_tenant_config INCLUDING ALL);

ALTER TABLE sc_tenant_config ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE SET NULL: the auth user who last touched config may be
-- removed; the config row stays and the audit trail in app.audit_events
-- preserves the "who".
ALTER TABLE sc_tenant_config
  DROP CONSTRAINT IF EXISTS sc_tenant_config_updated_by_user_id_fkey;
ALTER TABLE sc_tenant_config
  DROP CONSTRAINT IF EXISTS sc_tenant_config_updated_by_user_id_users_id_fk;
ALTER TABLE sc_tenant_config
  ADD CONSTRAINT sc_tenant_config_updated_by_user_id_fkey
  FOREIGN KEY (updated_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_tenant_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_tenant_config;
CREATE POLICY tenant_isolation ON sc_tenant_config
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
