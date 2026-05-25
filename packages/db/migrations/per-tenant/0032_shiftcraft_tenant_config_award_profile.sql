-- ShiftCraft per-tenant — sc_tenant_config.award_profile (Phase 2 #3b.5).
--
-- Adds a single jsonb column so a tenant can override any subset of
-- the @tracey/award defaults (daily/weekly thresholds, OT multipliers,
-- penalty multipliers, cost policy) without DDL when the shape evolves.
-- Null/empty = use the Modern Award general-rule defaults baked into
-- the package.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-runs on partially-migrated
-- tenants are safe.

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS award_profile jsonb;
