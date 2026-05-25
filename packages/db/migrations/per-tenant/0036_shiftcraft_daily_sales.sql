-- ShiftCraft per-tenant — sc_daily_sales (AUDIT.md Phase 2 #9).
--
-- Manually entered daily revenue per (location, business_date). Drives
-- the wages-vs-sales card on /app/reports. v1 is admin-keyed; a POS
-- adapter is deferred per the AU-only scope clarification.
--
-- Idempotent: IF NOT EXISTS guards + DROP/RE-ADD constraint pattern so
-- re-runs against partially-migrated tenants are safe.

CREATE TABLE IF NOT EXISTS sc_daily_sales (LIKE public.sc_daily_sales INCLUDING ALL);

ALTER TABLE sc_daily_sales ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- FKs into the shared app.users table.
ALTER TABLE sc_daily_sales
  DROP CONSTRAINT IF EXISTS sc_daily_sales_created_by_user_id_users_id_fk;
ALTER TABLE sc_daily_sales
  DROP CONSTRAINT IF EXISTS sc_daily_sales_created_by_user_id_fkey;
ALTER TABLE sc_daily_sales
  ADD CONSTRAINT sc_daily_sales_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_daily_sales
  DROP CONSTRAINT IF EXISTS sc_daily_sales_updated_by_user_id_users_id_fk;
ALTER TABLE sc_daily_sales
  DROP CONSTRAINT IF EXISTS sc_daily_sales_updated_by_user_id_fkey;
ALTER TABLE sc_daily_sales
  ADD CONSTRAINT sc_daily_sales_updated_by_user_id_fkey
  FOREIGN KEY (updated_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- FK to per-tenant sc_locations. RLS enforces same-tenant scoping but
-- the FK keeps referential integrity tight at the DB layer.
ALTER TABLE sc_daily_sales
  DROP CONSTRAINT IF EXISTS sc_daily_sales_location_id_fkey;
ALTER TABLE sc_daily_sales
  ADD CONSTRAINT sc_daily_sales_location_id_fkey
  FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_daily_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_daily_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_daily_sales;
CREATE POLICY tenant_isolation ON sc_daily_sales
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
