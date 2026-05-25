-- ShiftCraft per-tenant — sc_employees.award_profile (Phase 2 #3b.6).
--
-- Per-employee override on top of sc_tenant_config.award_profile. Same
-- jsonb shape; the resolver merges employee → tenant → @tracey/award
-- defaults per field. Null = inherit the tenant value.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS award_profile jsonb;
