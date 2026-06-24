-- ShiftCraft per-tenant — sc_timesheet_day_approvals.
--
-- Per-(employee, work_date) approval ledger. Finer-grained sibling of
-- sc_timesheet_approvals (week-level), powering the timesheet grid's per-day
-- approve/dispute controls. The week-level table stays the source of truth for
-- downstream consumers; the app rolls per-day state up into it. Same per-tenant
-- clone pattern as 0018: LIKE-clone the public template, override the
-- tracey_tenant_id default, re-attach FKs to app.users, enable RLS.

-- 1. Table.
CREATE TABLE IF NOT EXISTS sc_timesheet_day_approvals
  (LIKE public.sc_timesheet_day_approvals INCLUDING ALL);

-- 2. Tenant default.
ALTER TABLE sc_timesheet_day_approvals ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- 3. FKs to app.users (LIKE does not copy foreign keys).
ALTER TABLE sc_timesheet_day_approvals
  ADD CONSTRAINT sc_timesheet_day_approvals_employee_user_id_fkey
  FOREIGN KEY (employee_user_id) REFERENCES app.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_timesheet_day_approvals
  ADD CONSTRAINT sc_timesheet_day_approvals_approved_by_user_id_fkey
  FOREIGN KEY (approved_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

-- 4. RLS.
ALTER TABLE sc_timesheet_day_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_timesheet_day_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_timesheet_day_approvals;
CREATE POLICY tenant_isolation ON sc_timesheet_day_approvals
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));

-- 5. Backfill: expand existing week-level approvals into per-day rows so weeks
--    already signed off render as per-day approved. Idempotent via ON CONFLICT.
--    A fresh tenant's week table is empty, so this is a no-op there.
INSERT INTO sc_timesheet_day_approvals
  (tracey_tenant_id, employee_user_id, work_date, status, notes,
   approved_by_user_id, approved_at, updated_at)
SELECT a.tracey_tenant_id, a.employee_user_id,
       (a.week_start + g.d)::date, a.status, a.notes,
       a.approved_by_user_id, a.approved_at, a.updated_at
FROM sc_timesheet_approvals a
CROSS JOIN generate_series(0, 6) AS g(d)
ON CONFLICT (tracey_tenant_id, employee_user_id, work_date) DO NOTHING;
