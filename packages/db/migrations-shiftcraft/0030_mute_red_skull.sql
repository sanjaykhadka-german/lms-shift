-- AUDIT.md Feature 6 — leave accrual rates per leave type.
--
-- numeric(8,6) supports rates up to 99.999999 hours per hour of work —
-- well beyond any sane accrual policy. Null = no accrual (Unpaid /
-- Other). Public-template column only; the per-tenant migration
-- 0042_shiftcraft_leave_accrual.sql backfills the seeded rows.

ALTER TABLE "sc_leave_types" ADD COLUMN IF NOT EXISTS "accrual_rate_per_hour" numeric(8, 6);
