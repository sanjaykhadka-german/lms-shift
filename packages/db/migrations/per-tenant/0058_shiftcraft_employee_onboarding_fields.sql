-- ShiftCraft per-tenant — sc_employees self-service onboarding fields.
--
-- Four additive, nullable columns captured by the employee onboarding form
-- (app/app/people/onboarding) and persisted by submitEmployeeOnboardingAction:
--   emergency_contact_relationship : text — relationship label (the form
--                                    rejects digit-only values, so this is
--                                    never a phone number). Distinct from
--                                    emergency_contact_name / _phone.
--   bank_account_name              : text — account holder name. The BSB and
--                                    account number themselves stay encrypted
--                                    in bsb_enc / account_number_enc.
--   tfn_declaration                : jsonb — ATO TFN declaration answers
--                                    { residency, payBasis, claimTaxFreeThreshold,
--                                      hasStudyLoan, declaredTrueAt }. The TFN
--                                    itself stays encrypted in tfn_enc.
--   work_eligibility               : jsonb — { workVisa, superEligible }.
--
-- Public template gains these via migrate-shiftcraft 0045 (runs first); this
-- back-fills existing tenant schemas. Idempotent via ADD COLUMN IF NOT EXISTS.
-- Unqualified name resolves to the tenant schema via the runner's SET LOCAL
-- search_path.

ALTER TABLE sc_employees
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text,
  ADD COLUMN IF NOT EXISTS bank_account_name              text,
  ADD COLUMN IF NOT EXISTS tfn_declaration                jsonb,
  ADD COLUMN IF NOT EXISTS work_eligibility               jsonb;
