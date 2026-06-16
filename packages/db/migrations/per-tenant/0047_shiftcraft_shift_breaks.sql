-- ShiftCraft per-tenant — scheduled break minutes on sc_shifts (paid + unpaid
-- split). The unpaid portion is deducted from net paid hours / labour cost;
-- the paid portion is informational. Both default to 0 so existing shifts
-- back-fill as "no break".
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded ADD CONSTRAINT so a re-run
-- (or a fresh tenant whose public template already carries the columns via
-- LIKE INCLUDING ALL) doesn't error. Unqualified table name resolves to the
-- tenant schema via the runner's SET LOCAL search_path.

ALTER TABLE sc_shifts
  ADD COLUMN IF NOT EXISTS break_paid_minutes integer NOT NULL DEFAULT 0;

ALTER TABLE sc_shifts
  ADD COLUMN IF NOT EXISTS break_unpaid_minutes integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_shifts_break_chk'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE sc_shifts
      ADD CONSTRAINT sc_shifts_break_chk
      CHECK (break_paid_minutes >= 0 AND break_unpaid_minutes >= 0);
  END IF;
END $$;
