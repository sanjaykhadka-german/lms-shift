-- ShiftCraft per-tenant — sc_kiosk_devices.allow_visitors.
--
-- Per-device opt-in for the reception visitor sign-in flow. Default false:
-- existing kiosks stay clock-in only until a manager enables it. Idempotent.

ALTER TABLE sc_kiosk_devices
  ADD COLUMN IF NOT EXISTS allow_visitors boolean NOT NULL DEFAULT false;
