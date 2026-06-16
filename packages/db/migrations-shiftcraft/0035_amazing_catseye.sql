-- Public template: per-shift list of breaks ({label,minutes,paid}). The
-- *_minutes columns (added in 0034) remain as denormalized totals. Idempotent
-- so re-runs / generate re-emits are safe.
ALTER TABLE "sc_shifts" ADD COLUMN IF NOT EXISTS "breaks" jsonb DEFAULT '[]'::jsonb NOT NULL;
