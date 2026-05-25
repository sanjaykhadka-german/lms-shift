-- ShiftCraft per-tenant — outbound webhooks (AUDIT.md Phase 2 #10).
--
-- Two tables: sc_webhook_subscriptions (URLs receivers register against
-- specific events) and sc_webhook_deliveries (append-only log of every
-- attempt). The emit helper at lib/webhooks.ts inserts a delivery row
-- and POSTs in-process with an HMAC-SHA256 X-Webhook-Signature header.
-- Failed deliveries can be retried from /app/admin/webhooks.

-- ─── sc_webhook_subscriptions ───
CREATE TABLE IF NOT EXISTS sc_webhook_subscriptions
  (LIKE public.sc_webhook_subscriptions INCLUDING ALL);

ALTER TABLE sc_webhook_subscriptions ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_webhook_subscriptions
  DROP CONSTRAINT IF EXISTS sc_webhook_subscriptions_created_by_user_id_users_id_fk;
ALTER TABLE sc_webhook_subscriptions
  DROP CONSTRAINT IF EXISTS sc_webhook_subscriptions_created_by_user_id_fkey;
ALTER TABLE sc_webhook_subscriptions
  ADD CONSTRAINT sc_webhook_subscriptions_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_webhook_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_webhook_subscriptions;
CREATE POLICY tenant_isolation ON sc_webhook_subscriptions
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── sc_webhook_deliveries ───
CREATE TABLE IF NOT EXISTS sc_webhook_deliveries
  (LIKE public.sc_webhook_deliveries INCLUDING ALL);

ALTER TABLE sc_webhook_deliveries ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- FK to the per-tenant sc_webhook_subscriptions. CASCADE: removing a
-- subscription should clean up its delivery history (no orphaned logs).
ALTER TABLE sc_webhook_deliveries
  DROP CONSTRAINT IF EXISTS sc_webhook_deliveries_subscription_id_fkey;
ALTER TABLE sc_webhook_deliveries
  ADD CONSTRAINT sc_webhook_deliveries_subscription_id_fkey
  FOREIGN KEY (subscription_id) REFERENCES sc_webhook_subscriptions(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_webhook_deliveries;
CREATE POLICY tenant_isolation ON sc_webhook_deliveries
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
