-- ShiftCraft per-tenant — per-shift breaks list (JSONB array of
-- {label, minutes, paid}). Source of truth for the break editor; the
-- break_paid_minutes / break_unpaid_minutes columns (per-tenant 0047) stay as
-- denormalized totals. Idempotent. Unqualified name resolves to the tenant
-- schema via the runner's SET LOCAL search_path.

ALTER TABLE sc_shifts
  ADD COLUMN IF NOT EXISTS breaks jsonb NOT NULL DEFAULT '[]'::jsonb;
