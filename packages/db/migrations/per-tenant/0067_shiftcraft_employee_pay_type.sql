-- ShiftCraft per-tenant — sc_employees.pay_type (Slice 1: salaried support).
--
-- pay_type drives the Xero payroll export:
--   'hourly'   (default) : worked hours are pushed to Xero as paid timesheet
--                          lines (the existing behaviour).
--   'salaried'           : worked hours stay recorded/rostered in ShiftCraft
--                          but are EXCLUDED from the Xero hours export — Xero's
--                          fixed Salary line pays them; pushing hourly hours on
--                          top would double-pay.
--
-- Public template gains this via migrate-shiftcraft 0054 (runs first); this
-- back-fills existing tenant schemas. Idempotent: ADD COLUMN IF NOT EXISTS +
-- a guarded ADD CONSTRAINT. Unqualified name resolves to the tenant schema via
-- the runner's SET LOCAL search_path.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'hourly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_employees_pay_type_chk'
      AND conrelid = 'sc_employees'::regclass
  ) THEN
    ALTER TABLE sc_employees
      ADD CONSTRAINT sc_employees_pay_type_chk
      CHECK (pay_type IN ('hourly','salaried'));
  END IF;
END $$;
