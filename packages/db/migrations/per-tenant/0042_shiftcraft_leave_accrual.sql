-- ShiftCraft per-tenant — leave accrual rates (AUDIT.md Feature 6).
--
-- Adds the per-tenant column + backfills AU general-rule defaults onto
-- the seeded rows. Custom admin-created leave types keep null (no
-- accrual) until the admin sets a rate.
--
-- Rate semantics: hours of leave accrued per hour of ORDINARY work.
-- - Annual: 4 weeks / 52 weeks = 0.076923
-- - Personal/Sick: 2 weeks / 52 weeks = 0.038462
-- - Unpaid + Other: null (no accrual)
-- - Long service: 0 by default — state-dependent, admin enters
--   their tenant's actual rate via /app/admin/leave-types.

ALTER TABLE sc_leave_types
  ADD COLUMN IF NOT EXISTS accrual_rate_per_hour numeric(8, 6);

UPDATE sc_leave_types
SET accrual_rate_per_hour = 0.076923
WHERE tracey_tenant_id = current_setting('app.tenant_id', true)
  AND slug = 'annual'
  AND accrual_rate_per_hour IS NULL;

UPDATE sc_leave_types
SET accrual_rate_per_hour = 0.038462
WHERE tracey_tenant_id = current_setting('app.tenant_id', true)
  AND slug = 'personal_sick'
  AND accrual_rate_per_hour IS NULL;

-- Long service starts at 0 — semantically "configured but not
-- accruing", distinct from null which is "no accrual at all".
UPDATE sc_leave_types
SET accrual_rate_per_hour = 0
WHERE tracey_tenant_id = current_setting('app.tenant_id', true)
  AND slug = 'long_service'
  AND accrual_rate_per_hour IS NULL;
