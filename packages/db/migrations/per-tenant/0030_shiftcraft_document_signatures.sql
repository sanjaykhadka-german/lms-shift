-- ShiftCraft per-tenant — sc_document_signatures + requires_signature flag.
--
-- AUDIT.md Phase 2 #2c. Captures the legal-evidence record of every
-- e-sign event on a team-scoped sc_documents row:
--   - who signed (signer_app_user_id + denormalised email/name)
--   - what they typed (signature_text)
--   - when (signed_at, server clock UTC)
--   - where from (signer_ip, signer_user_agent — best-effort)
--   - proof the source hasn't changed (source_document_hash, SHA-256 hex)
--
-- The new sc_documents.requires_signature flag is the manager-controlled
-- toggle that surfaces the "Sign" affordance to the assigned employee.
-- Default false so existing rows back-fill cleanly.
--
-- Idempotent: IF NOT EXISTS + DROP/ADD on constraints so re-runs on
-- partially-migrated tenants are safe.

ALTER TABLE sc_documents
  ADD COLUMN IF NOT EXISTS requires_signature boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS sc_document_signatures
  (LIKE public.sc_document_signatures INCLUDING ALL);

ALTER TABLE sc_document_signatures ALTER COLUMN tracey_tenant_id
  SET DEFAULT current_setting('app.tenant_id', true);

-- Re-attach FK to the per-tenant copy of sc_documents (the public template
-- target is replaced by the local one). ON DELETE CASCADE: removing a doc
-- wipes its signatures since the audit record is keyed by document_id —
-- the audit_events table holds the long-lived trail.
ALTER TABLE sc_document_signatures
  DROP CONSTRAINT IF EXISTS sc_document_signatures_document_id_fkey;
ALTER TABLE sc_document_signatures
  DROP CONSTRAINT IF EXISTS sc_document_signatures_document_id_sc_documents_id_fk;
ALTER TABLE sc_document_signatures
  ADD CONSTRAINT sc_document_signatures_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES sc_documents(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

-- ON DELETE SET NULL: signer auth user may later be removed from app.users;
-- the signature row stays as evidence (denormalised email/name preserve the
-- "who" even when the FK clears).
ALTER TABLE sc_document_signatures
  DROP CONSTRAINT IF EXISTS sc_document_signatures_signer_app_user_id_fkey;
ALTER TABLE sc_document_signatures
  DROP CONSTRAINT IF EXISTS sc_document_signatures_signer_app_user_id_users_id_fk;
ALTER TABLE sc_document_signatures
  ADD CONSTRAINT sc_document_signatures_signer_app_user_id_fkey
  FOREIGN KEY (signer_app_user_id) REFERENCES app.users(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE sc_document_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sc_document_signatures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sc_document_signatures;
CREATE POLICY tenant_isolation ON sc_document_signatures
  USING (tracey_tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tracey_tenant_id = current_setting('app.tenant_id', true));
