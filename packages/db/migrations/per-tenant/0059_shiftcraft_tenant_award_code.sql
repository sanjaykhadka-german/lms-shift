-- ShiftCraft per-tenant — named award on sc_tenant_config (AUDIT.md Feature 4,
-- Fair Work integration, Slice A).
--
-- Adds the Modern Award code + effective date so a workspace can pick its
-- award (e.g. MA000059) and stamp the matching @tracey/award preset into
-- award_profile. Idempotent.

ALTER TABLE sc_tenant_config ADD COLUMN IF NOT EXISTS award_code text;
ALTER TABLE sc_tenant_config ADD COLUMN IF NOT EXISTS award_effective_from date;
