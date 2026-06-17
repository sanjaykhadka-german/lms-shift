-- ShiftCraft per-tenant — clock-in policy controls on sc_tenant_config.
--
-- Adds five booleans that let admins decide how staff clock in from the web
-- (Slice: clock-in flexibility + unscheduled shifts). Defaults preserve the
-- prior behaviour (web clock-in on; no geofence/selfie requirement; scheduled
-- shift not required). The public template gains the same columns via
-- migrate-shiftcraft 0040 (runs first); this back-fills existing tenant
-- schemas. Idempotent via ADD COLUMN IF NOT EXISTS. Unqualified name resolves
-- to the tenant schema via the runner's SET LOCAL search_path.

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS allow_web_clock boolean NOT NULL DEFAULT true;

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS allow_unscheduled_clock_in boolean NOT NULL DEFAULT false;

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS require_geofence boolean NOT NULL DEFAULT false;

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS require_selfie boolean NOT NULL DEFAULT false;

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS require_scheduled_shift boolean NOT NULL DEFAULT false;
