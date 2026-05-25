-- ShiftCraft per-tenant — sc_leave_types catalogue + sc_time_off_requests
-- linkage (AUDIT.md Phase 2 #6).
--
-- Replaces the previous free-text discriminator on time-off requests
-- with a typed FK to a per-tenant catalogue. Seeded with the five AU
-- standard categories (annual / personal-sick / unpaid / long service /
-- other) — admins can rename, archive, or add custom types via the
-- /app/admin/leave-types page.
--
-- Idempotent: IF NOT EXISTS for table/column/constraint/index/policy,
-- ON CONFLICT DO NOTHING for seed inserts, and the leave_type_id
-- backfill is gated on rows that don't already have one. Re-runs against
-- partially-migrated tenants are safe.

-- ─── 1. sc_leave_types table ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sc_leave_types (LIKE public.sc_leave_types INCLUDING ALL);

ALTER TABLE sc_leave_types ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_leave_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_leave_types;
CREATE POLICY tenant_isolation ON sc_leave_types
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- ─── 2. Seed default leave types ────────────────────────────────────
--
-- Five AU-standard categories that cover the bulk of workforce leave.
-- Slug is immutable and used by code to find these rows; name is the
-- display label and can be renamed via the admin page. sort_order
-- controls dropdown ordering with annual first, "other" last.

INSERT INTO sc_leave_types (tracey_tenant_id, slug, name, sort_order)
VALUES
  (current_setting('app.tenant_id', true), 'annual',        'Annual leave',         10),
  (current_setting('app.tenant_id', true), 'personal_sick', 'Personal/Sick leave',  20),
  (current_setting('app.tenant_id', true), 'unpaid',        'Unpaid leave',         30),
  (current_setting('app.tenant_id', true), 'long_service',  'Long service leave',   40),
  (current_setting('app.tenant_id', true), 'other',         'Other',                90)
ON CONFLICT (tracey_tenant_id, slug) DO NOTHING;

-- ─── 3. sc_time_off_requests.leave_type_id column + FK ──────────────

ALTER TABLE sc_time_off_requests
  ADD COLUMN IF NOT EXISTS leave_type_id uuid;

-- ─── 4. Backfill existing rows to the 'annual' default ──────────────
--
-- Pre-migration rows had no concept of a leave type. Assigning them all
-- to 'annual' keeps the data shape valid and matches what most casual
-- users meant when they submitted a request via the old form (the free
-- text reason field is preserved). Admins can re-categorise after the
-- fact via direct edit if needed.

UPDATE sc_time_off_requests
SET leave_type_id = lt.id
FROM sc_leave_types lt
WHERE sc_time_off_requests.leave_type_id IS NULL
  AND lt.tracey_tenant_id = current_setting('app.tenant_id', true)
  AND lt.slug = 'annual';

-- ─── 5. FK constraint pointing at the per-tenant sc_leave_types ─────
--
-- Drop the public-template-pointing FK if Drizzle's LIKE INCLUDING ALL
-- carried it across, then re-attach pointing at the per-tenant copy.
-- ON DELETE RESTRICT — types in active use can't be deleted; archive
-- them via the admin page instead.

ALTER TABLE sc_time_off_requests
  DROP CONSTRAINT IF EXISTS sc_time_off_requests_leave_type_id_sc_leave_types_id_fk;

ALTER TABLE sc_time_off_requests
  DROP CONSTRAINT IF EXISTS sc_time_off_requests_leave_type_id_fkey;

ALTER TABLE sc_time_off_requests
  ADD CONSTRAINT sc_time_off_requests_leave_type_id_fkey
  FOREIGN KEY (leave_type_id) REFERENCES sc_leave_types(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY IMMEDIATE;

-- ─── 6. Index on the new column ─────────────────────────────────────
--
-- Matches the public-template index name so re-introspection lines up.
-- Created by LIKE INCLUDING ALL when the table was first cut for new
-- tenants; this CREATE IF NOT EXISTS covers tenants whose
-- sc_time_off_requests pre-dates this column.

CREATE INDEX IF NOT EXISTS sc_time_off_leave_type_idx
  ON sc_time_off_requests (leave_type_id);
