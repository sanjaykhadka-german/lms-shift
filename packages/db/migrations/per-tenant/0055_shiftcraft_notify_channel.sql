-- ShiftCraft per-tenant — sc_tenant_config.notify_channel.
--
-- How shift notifications reach staff: 'email' | 'in_app' | 'both' (default
-- 'both', preserving the prior email behaviour). Public template gains the
-- column via migrate-shiftcraft 0042 (runs first); this back-fills existing
-- tenant schemas. Idempotent: ADD COLUMN IF NOT EXISTS + guarded constraint.
-- Unqualified name resolves to the tenant schema via SET LOCAL search_path.

ALTER TABLE sc_tenant_config
  ADD COLUMN IF NOT EXISTS notify_channel text NOT NULL DEFAULT 'both';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sc_tenant_config_notify_channel_chk'
      AND connamespace = current_schema()::regnamespace
  ) THEN
    ALTER TABLE sc_tenant_config
      ADD CONSTRAINT sc_tenant_config_notify_channel_chk
      CHECK (notify_channel IN ('email', 'in_app', 'both'));
  END IF;
END $$;
