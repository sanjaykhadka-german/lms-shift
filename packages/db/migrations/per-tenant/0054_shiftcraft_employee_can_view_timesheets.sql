-- ShiftCraft per-tenant — sc_employees.can_view_timesheets.
--
-- Grants a non-manager employee read access to the team timesheets page
-- (scoped to their location like a Location Manager). Default false so all
-- existing rows keep self-only visibility. Public template gains the column
-- via migrate-shiftcraft 0041 (runs first); this back-fills existing tenant
-- schemas. Idempotent via ADD COLUMN IF NOT EXISTS. Unqualified name resolves
-- to the tenant schema via the runner's SET LOCAL search_path.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS can_view_timesheets boolean NOT NULL DEFAULT false;
