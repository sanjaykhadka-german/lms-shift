-- ShiftCraft per-tenant — sc_employees.location_id + sc_employees.position
-- (AUDIT gap #1: per-employee home location + job title).
--
-- location_id is the employee's primary / home site. Nullable so existing
-- rows, contractors, and multi-site staff back-fill cleanly. The FK points
-- at the per-tenant sc_locations (re-attached here, not via the public
-- template, mirroring sc_employees.department_id in migration 0019).
--
-- position is a free-text job title ("Butcher", "QA Supervisor"); distinct
-- from the award classification stored in award_profile.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded ADD CONSTRAINT so a
-- re-run (or a fresh tenant whose public template already carries the FK)
-- doesn't error.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS location_id uuid;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS position text;

-- FK on location_id → per-tenant sc_locations. Guarded so the migration is
-- safe to re-apply: only create the constraint when it isn't already there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_employees_location_id_fkey'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE sc_employees
      ADD CONSTRAINT sc_employees_location_id_fkey
      FOREIGN KEY (location_id) REFERENCES sc_locations(id) ON DELETE SET NULL
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sc_employees_location_idx
  ON sc_employees (location_id);
