-- Backfill a ShiftCraft subscription row for every EXISTING tenant so the
-- per-app entitlement gate (apps/shiftcraft-web/lib/billing/access.ts) does
-- not lock them out when SHIFTCRAFT_BILLING_ENFORCED is flipped to "true".
--
-- Background: the gate reads app.tenant_subscriptions WHERE app='shiftcraft'.
-- New workspaces get a trialing row at onboarding (onboarding/actions.ts), but
-- the 6 live prod tenants predate that code and have no shiftcraft row. A
-- missing row → accessLevelFor() returns "blocked" → the whole /app is walled.
--
-- These tenants are already using ShiftCraft in production, so grandfather
-- them in as status='active' (full access, no Stripe subscription attached).
-- They can later subscribe via /app/billing, at which point the webhook
-- overwrites this row with the real Stripe state. plan='pro' is a neutral
-- "no feature implied locked" default — our code does not gate features by
-- plan today.
--
-- Idempotent: ON CONFLICT (tenant_id, app) DO NOTHING — re-running is a no-op,
-- and any tenant that already has a (trialing) shiftcraft row is left alone.
--
-- ORDER: run AFTER the tenant_subscriptions table exists (Drizzle migration
-- 0008_same_silver_surfer.sql / `pnpm -F @tracey/db migrate-shiftcraft`), and
-- BEFORE setting SHIFTCRAFT_BILLING_ENFORCED=true on the shiftcraft-web service.
--
-- HOW TO RUN
-- ----------
-- Local:
--   psql "postgres://root:root@localhost:5432/lms" \
--        -f packages/db/migrations/manual/0011_backfill_shiftcraft_subscriptions.sql
--
-- Render (lms-db): Dashboard → lms-db → Connect → External psql, paste the
-- INSERT below, then run the verification SELECT.

INSERT INTO app.tenant_subscriptions (tenant_id, app, plan, status)
SELECT t.id, 'shiftcraft', 'pro', 'active'
  FROM app.tenants t
 ON CONFLICT (tenant_id, app) DO NOTHING;

-- Verify after running:
-- SELECT t.name, s.app, s.plan, s.status, s.trial_ends_at
--   FROM app.tenants t
--   LEFT JOIN app.tenant_subscriptions s
--     ON s.tenant_id = t.id AND s.app = 'shiftcraft'
--  ORDER BY t.created_at;
