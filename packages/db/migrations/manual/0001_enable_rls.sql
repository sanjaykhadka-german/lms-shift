-- Row-per-tenant Row-Level Security.
--
-- Tenant isolation is enforced by comparing each row's tenant column against
-- the `app.tenant_id` GUC, which forTenant().run() sets per transaction (see
-- packages/db/src/client.ts). FORCE ROW LEVEL SECURITY is required because the
-- application connects as the table owner (postgres), which would otherwise
-- bypass RLS — we want the GUC genuinely enforced.
--
-- Idempotent: ENABLE/FORCE are no-ops if already set, and the policy is
-- DROP-then-CREATE. Safe to re-run (migrate.ts applies it on every deploy).

-- Tables keyed on `tracey_tenant_id` (LMS public.* + ShiftCraft public.sc_*).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- LMS
    'public.users',
    'public.modules',
    'public.content_items',
    'public.content_item_media',
    'public.module_media',
    'public.questions',
    'public.choices',
    'public.assignments',
    'public.module_versions',
    'public.attempts',
    'public.departments',
    'public.employers',
    'public.machines',
    'public.positions',
    'public.user_machines',
    'public.machine_modules',
    'public.department_module_policies',
    'public.position_module_policies',
    'public.whs_records',
    'public.whs_kinds',
    'public.audit_logs',
    'public.uploaded_files',
    -- ShiftCraft
    'public.sc_locations',
    'public.sc_shifts',
    'public.sc_shift_assignments',
    'public.sc_time_off_requests'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s '
      || 'USING (tracey_tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tracey_tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;

-- Tables keyed on `tenant_id` (app.* tenant-scoped tables).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'app.notifications',
    'app.ai_studio_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %s '
      || 'USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END $$;
