-- ShiftCraft per-tenant — default breaks + required skill on
-- sc_shift_templates, so a saved template remembers them and the "From
-- template" picker prefills them when creating a shift.
--
-- Mirrors sc_shifts.breaks / sc_shifts.required_skill_id (per-tenant 0048 /
-- 0040). Idempotent: ADD COLUMN IF NOT EXISTS + guarded FK so a re-run, or a
-- fresh tenant whose public template already carries the columns via LIKE
-- INCLUDING ALL, doesn't error. Unqualified names resolve to the tenant
-- schema via the runner's SET LOCAL search_path. sc_skills already exists in
-- the tenant schema (per-tenant 0040 runs first).

ALTER TABLE sc_shift_templates
  ADD COLUMN IF NOT EXISTS default_breaks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE sc_shift_templates
  ADD COLUMN IF NOT EXISTS required_skill_id uuid;

ALTER TABLE sc_shift_templates
  DROP CONSTRAINT IF EXISTS sc_shift_templates_required_skill_id_fkey;
ALTER TABLE sc_shift_templates
  ADD CONSTRAINT sc_shift_templates_required_skill_id_fkey
  FOREIGN KEY (required_skill_id) REFERENCES sc_skills(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;
