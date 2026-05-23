-- ShiftCraft per-tenant — sc_clock_events void support.
--
-- Adds the void columns + index to the existing per-tenant copy of
-- sc_clock_events. Idempotent — ADD COLUMN IF NOT EXISTS + CREATE INDEX
-- IF NOT EXISTS so a re-run is a no-op. No backfill needed: existing
-- rows have voided_at = NULL, which the read paths in lib/clock.ts
-- treat as "active" (current behavior).

ALTER TABLE sc_clock_events
  ADD COLUMN IF NOT EXISTS voided_at timestamptz;

ALTER TABLE sc_clock_events
  ADD COLUMN IF NOT EXISTS voided_by_user_id uuid;

ALTER TABLE sc_clock_events
  ADD COLUMN IF NOT EXISTS void_reason text;

-- Re-attach the FK to app.users (per-tenant migrations don't inherit
-- cross-schema FKs via LIKE INCLUDING ALL). DROP IF EXISTS so a re-run
-- doesn't error.
ALTER TABLE sc_clock_events
  DROP CONSTRAINT IF EXISTS sc_clock_events_voided_by_user_id_fkey;
ALTER TABLE sc_clock_events
  ADD CONSTRAINT sc_clock_events_voided_by_user_id_fkey
  FOREIGN KEY (voided_by_user_id) REFERENCES app.users(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- Index supports the dominant "active events for user X" query path
-- once void rows accumulate. Composite (app_user_id, voided_at) so the
-- planner can use the index for both filter directions.
CREATE INDEX IF NOT EXISTS sc_clock_events_user_voided_idx
  ON sc_clock_events (app_user_id, voided_at);
