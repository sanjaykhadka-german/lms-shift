-- ShiftCraft per-tenant — personal-detail columns on sc_employees.
--
-- Adds the fields the Deputy-style employee profile modal surfaces:
-- preferred name, gender (with check constraint), DOB, address,
-- emergency contact. All nullable so existing rows back-fill cleanly.
--
-- Idempotent: IF NOT EXISTS + DROP IF EXISTS so re-runs on partially-
-- migrated tenants are safe.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS preferred_name text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS address_line text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS emergency_contact_name text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

ALTER TABLE sc_employees
  DROP CONSTRAINT IF EXISTS sc_employees_gender_chk;
ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_gender_chk
  CHECK (gender IS NULL OR gender IN ('female','male','non_binary','prefer_not_to_say'));
