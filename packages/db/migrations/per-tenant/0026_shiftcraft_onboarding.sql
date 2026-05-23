-- ShiftCraft per-tenant — new-hire onboarding.
--
-- Adds three onboarding-tracking columns to sc_employees plus a new
-- sc_employee_onboarding_tasks table holding the per-employee checklist
-- spawned when an admin starts onboarding for a new hire.
--
-- Idempotent: uses IF NOT EXISTS for columns/constraints/indexes/policies
-- so re-runs against partially-migrated tenants are safe.
--
-- Backfill: existing employees default to onboarding_status='active'
-- (already-onboarded), preserving the current sidebar/list behavior
-- for pre-existing rows. Only new hires created after this migration
-- will appear in the onboarding queue.

-- ─── sc_employees onboarding columns ───

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'active';

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS onboarding_started_at timestamp with time zone;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamp with time zone;

ALTER TABLE sc_employees
  DROP CONSTRAINT IF EXISTS sc_employees_onboarding_status_chk;
ALTER TABLE sc_employees
  ADD CONSTRAINT sc_employees_onboarding_status_chk
  CHECK (onboarding_status IN ('pending','in_progress','active'));

CREATE INDEX IF NOT EXISTS sc_employees_onboarding_idx
  ON sc_employees (tracey_tenant_id, onboarding_status);

-- ─── sc_employee_onboarding_tasks ───
--
-- Same per-tenant pattern as the other sc_* tables: clone the public
-- template (no FKs), set tracey_tenant_id default to current session,
-- re-attach FKs explicitly, enable RLS.

CREATE TABLE IF NOT EXISTS sc_employee_onboarding_tasks
  (LIKE public.sc_employee_onboarding_tasks INCLUDING ALL);

ALTER TABLE sc_employee_onboarding_tasks ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- ON DELETE CASCADE: removing an employee wipes their checklist.
ALTER TABLE sc_employee_onboarding_tasks
  DROP CONSTRAINT IF EXISTS sc_employee_onboarding_tasks_employee_id_fkey;
ALTER TABLE sc_employee_onboarding_tasks
  ADD CONSTRAINT sc_employee_onboarding_tasks_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES sc_employees(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ON DELETE SET NULL: audit trail of who marked a task done survives
-- the manager being removed from the tenant.
ALTER TABLE sc_employee_onboarding_tasks
  DROP CONSTRAINT IF EXISTS sc_employee_onboarding_tasks_completed_by_user_id_fkey;
ALTER TABLE sc_employee_onboarding_tasks
  ADD CONSTRAINT sc_employee_onboarding_tasks_completed_by_user_id_fkey
  FOREIGN KEY (completed_by_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_employee_onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_employee_onboarding_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_employee_onboarding_tasks;
CREATE POLICY tenant_isolation ON sc_employee_onboarding_tasks
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
