-- ShiftCraft per-tenant — sc_visitor_signins visitor-policy screening fields.
--
-- Six additive, nullable columns captured by the kiosk visitor sign-in form
-- (app/kiosk/visitor) per the Visitors Policy (POL 1.4.1.2):
--   brought_tools       : boolean — did the visitor bring tools/equipment?
--   tools_description   : text    — what tools (only when brought_tools = true)
--   recent_illness      : boolean — illness/sickness symptoms in the last 3 days?
--   illness_description : text    — details (only when recent_illness = true)
--   policy_agreed       : boolean — visitor ticked "I agree" to the policy
--   policy_version      : text    — which policy version was agreed (e.g.
--                                   "POL 1.4.1.2 2026"), for compliance records
--
-- Public template gains these via migrate-shiftcraft 0050 (runs first); this
-- back-fills existing tenant schemas. Idempotent via ADD COLUMN IF NOT EXISTS.
-- Unqualified name resolves to the tenant schema via the runner's SET LOCAL
-- search_path.

ALTER TABLE sc_visitor_signins
  ADD COLUMN IF NOT EXISTS brought_tools       boolean,
  ADD COLUMN IF NOT EXISTS tools_description   text,
  ADD COLUMN IF NOT EXISTS recent_illness      boolean,
  ADD COLUMN IF NOT EXISTS illness_description text,
  ADD COLUMN IF NOT EXISTS policy_agreed       boolean,
  ADD COLUMN IF NOT EXISTS policy_version      text;
