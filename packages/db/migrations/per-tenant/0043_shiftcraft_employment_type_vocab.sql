-- ShiftCraft per-tenant — employment-type vocabulary alignment.
--
-- The legacy vocabulary (`permanent` | `casual` | `labour_hire`) is
-- replaced with the AU brief's (`full_time` | `part_time` | `casual` |
-- `contractor`). Existing rows are remapped:
--   permanent   -> full_time   (we can't distinguish FT vs PT historically;
--                               full_time is the safe default. Managers
--                               re-flag part-timers from the edit form.)
--   labour_hire -> contractor  (same "roster-only / external" semantics:
--                               no leave accrual, no LMS suggestion, never
--                               auto-invited.)
--   casual      -> casual      (unchanged)
-- `part_time` is brand new — selectable going forward, no historical rows.
--
-- Runs with search_path already set to the tenant schema by
-- per-tenant-migrate.ts, so the unqualified table name resolves to this
-- tenant's copy of sc_employees.
--
-- Order is deliberate: the old CHECK forbids the new values, so we must
-- drop it BEFORE backfilling, then re-add the new CHECK only once every
-- row holds a permitted value. Idempotent (IF EXISTS on the drop; the
-- UPDATEs no-op once values are already migrated).

ALTER TABLE sc_employees
  DROP CONSTRAINT IF EXISTS sc_employees_employment_type_chk;

UPDATE sc_employees
  SET employment_type = 'full_time'
  WHERE employment_type = 'permanent';

UPDATE sc_employees
  SET employment_type = 'contractor'
  WHERE employment_type = 'labour_hire';

ALTER TABLE sc_employees
  ALTER COLUMN employment_type SET DEFAULT 'full_time';

ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_employment_type_chk
  CHECK (employment_type IN ('full_time','part_time','casual','contractor'));
