-- ShiftCraft per-tenant — customisable onboarding checklist templates.
-- Per-tenant copy of public.sc_onboarding_task_templates (public created by
-- migrate-shiftcraft 0039, which runs first). Clones structure via LIKE
-- INCLUDING ALL, then applies the standard tenant_id default + RLS policy —
-- mirrors the sc_skills pattern (per-tenant 0040). Idempotent: CREATE TABLE
-- IF NOT EXISTS + DROP POLICY IF EXISTS. Unqualified name resolves to the
-- tenant schema via the runner's SET LOCAL search_path.

CREATE TABLE IF NOT EXISTS sc_onboarding_task_templates
  (LIKE public.sc_onboarding_task_templates INCLUDING ALL);

ALTER TABLE sc_onboarding_task_templates ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

ALTER TABLE sc_onboarding_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_onboarding_task_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_onboarding_task_templates;
CREATE POLICY tenant_isolation ON sc_onboarding_task_templates
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
