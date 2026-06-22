-- ShiftCraft per-tenant — sc_employees first_name / last_name.
--
-- Two additive, nullable columns so employee names are captured as
-- first + last (Deputy-style). full_name is kept as the canonical
-- "First Last" display string (written on every save), so the ~30 read
-- sites (kiosk, schedule, search, exports, …) need no changes.
--
-- Public template gains these via migrate-shiftcraft (0049, runs first);
-- this back-fills existing tenant schemas. Idempotent via ADD COLUMN IF
-- NOT EXISTS + a NULL-guarded backfill. Unqualified name resolves to the
-- tenant schema via the runner's SET LOCAL search_path.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

-- Backfill existing rows by splitting full_name: the first whitespace token
-- becomes first_name; everything after it becomes last_name (NULL if the
-- name is a single word). Only fills rows not yet split, so it's a no-op on
-- re-run and never clobbers a value set by the new first/last forms.
UPDATE sc_employees
   SET first_name = split_part(full_name, ' ', 1),
       last_name  = NULLIF(btrim(regexp_replace(full_name, '^\S+\s*', '')), '')
 WHERE first_name IS NULL
   AND full_name IS NOT NULL;
