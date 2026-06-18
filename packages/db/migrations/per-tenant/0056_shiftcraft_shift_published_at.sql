-- ShiftCraft per-tenant — sc_shifts.published_at.
--
-- Records when a shift was last published. The schedule compares
-- updatedAt > publishedAt to flag shifts that were edited after going live
-- and to re-include them in the publish action. Public template gains the
-- column via migrate-shiftcraft 0043 (runs first); this back-fills existing
-- tenant schemas. Idempotent via ADD COLUMN IF NOT EXISTS. Unqualified name
-- resolves to the tenant schema via the runner's SET LOCAL search_path.
--
-- Backfill: existing published shifts predate the column, so seed
-- published_at from updated_at. Without this every already-published shift
-- would read as "edited since publish" (published_at IS NULL) on first load.

ALTER TABLE sc_shifts
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE sc_shifts
  SET published_at = updated_at
  WHERE status = 'published' AND published_at IS NULL;
