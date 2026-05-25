-- ShiftCraft per-tenant — web push subscriptions (AUDIT.md #12).
--
-- One row per (user, browser endpoint). The web-push helper at
-- lib/web-push.ts deletes rows whose endpoint returns 410 Gone
-- so the table stays pruned without a separate sweep job.

CREATE TABLE IF NOT EXISTS sc_push_subscriptions
  (LIKE public.sc_push_subscriptions INCLUDING ALL);

ALTER TABLE sc_push_subscriptions ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_push_subscriptions
  DROP CONSTRAINT IF EXISTS sc_push_subscriptions_app_user_id_users_id_fk;
ALTER TABLE sc_push_subscriptions
  DROP CONSTRAINT IF EXISTS sc_push_subscriptions_app_user_id_fkey;
ALTER TABLE sc_push_subscriptions
  ADD CONSTRAINT sc_push_subscriptions_app_user_id_fkey
  FOREIGN KEY (app_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_push_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_push_subscriptions;
CREATE POLICY tenant_isolation ON sc_push_subscriptions
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
