-- ShiftCraft per-tenant — encrypted payroll PII columns on sc_employees.
--
-- Five new columns to capture the at-rest secrets needed for AU payroll
-- handoff (AUDIT.md Phase 2 #2a):
--   tfn_enc                : Tax File Number, AES-256-GCM ciphertext
--   bsb_enc                : Bank-State-Branch (6-digit routing), ciphertext
--   account_number_enc     : Bank account number, ciphertext
--   super_fund_name        : Plaintext — the fund name (e.g. "AustralianSuper")
--                            is not sensitive on its own
--   super_member_number_enc: Member number within the fund, ciphertext
--
-- Encryption happens application-side via @tracey/db's `pii` helper
-- (AES-256-GCM with TRACEY_PII_ENC_KEY). Stored value is a `v1:<base64>`
-- token — see packages/db/src/pii.ts. Tokens are opaque text from
-- Postgres's perspective; no pgcrypto extension is required.
--
-- All columns nullable so existing rows back-fill cleanly.
-- Idempotent: IF NOT EXISTS so re-runs on partially-migrated tenants are safe.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS tfn_enc text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS bsb_enc text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS account_number_enc text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS super_fund_name text;

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS super_member_number_enc text;
