-- Local-only setup: create a non-superuser role for RLS regression tests.
-- Idempotent — re-run is safe.
--
-- Why: the default lms_dev DATABASE_URL connects as `root`, which is a
-- Postgres superuser and bypasses RLS. Tests run under that role pass green
-- even when the code-under-test silently no-ops under prod's enforced RLS.
-- Yesterday's tenant-copy / tenant-backup / tenant-provision bugs are the
-- canonical example. This role lets a regression test reproduce prod
-- conditions on local.
--
-- Run via:  pnpm -C apps/lms-web run setup:test-rls-role
-- Or apply manually in pgAdmin against lms_dev.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracey_test_rls') THEN
    CREATE ROLE tracey_test_rls LOGIN PASSWORD 'tracey_test_rls';
  END IF;
END $$;

-- Schema-level USAGE.
GRANT USAGE ON SCHEMA app TO tracey_test_rls;
GRANT USAGE ON SCHEMA public TO tracey_test_rls;

-- public.* DML — RLS still applies (this role is NOT superuser, so
-- FORCE ROW LEVEL SECURITY enforces the tenant_isolation policy).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tracey_test_rls;
-- USAGE + UPDATE on sequences: nextval() needs USAGE, setval() needs UPDATE.
-- dataCopySql runs setval on every ID-bearing per-tenant sequence, so UPDATE
-- is required even though tracey_test_rls only writes to public.lms_* in
-- the regression test.
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO tracey_test_rls;

-- app.* read access (no writes — the regression test only needs to read
-- tenant rows for setup, then runs the code-under-test on public.lms_*).
GRANT SELECT ON ALL TABLES IN SCHEMA app TO tracey_test_rls;

-- Future-proofing: grants automatically apply to tables/sequences that root
-- creates later in any schema (e.g. tenant_<uuid> created by provisionTenant).
ALTER DEFAULT PRIVILEGES FOR ROLE root
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tracey_test_rls;
ALTER DEFAULT PRIVILEGES FOR ROLE root
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO tracey_test_rls;
ALTER DEFAULT PRIVILEGES FOR ROLE root
  GRANT USAGE ON SCHEMAS TO tracey_test_rls;
