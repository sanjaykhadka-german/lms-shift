-- One-shot prod fix: move qc@germanbutchery.com.au from an accidental
-- orphan tenant into the existing German Butchery tenant, then drop
-- the orphan tenant + its empty per-tenant schema.
--
-- Run in pgAdmin against the prod `lms-db`. Execute SECTION 1 first,
-- fill in the captured UUIDs in SECTION 2, then run SECTION 2 and
-- SECTION 3.
--
-- Authored 2026-05-19. Safe to delete after the fix lands.


-- ────────────────────────────────────────────────────────────────────
-- SECTION 1 — DISCOVERY (read-only). Capture the four IDs you need.
-- ────────────────────────────────────────────────────────────────────

-- 1a. The qc user row.
SELECT id, email, name, email_verified, created_at
FROM app.users
WHERE email = 'qc@germanbutchery.com.au';
-- → record :qc_user_id

-- 1b. The existing GB tenant (sanity-check against memory: 7a055706-…).
SELECT id, name, slug, created_at, owner_user_id
FROM app.tenants
WHERE slug ILIKE 'german%' OR name ILIKE 'german%'
ORDER BY created_at;
-- → record :gb_tenant_id  (expected to start 7a055706-…)

-- 1c. The orphan tenant qc owns. Replace <qc_user_id> with the value
--     from 1a before running.
SELECT id, name, slug, created_at, status, plan
FROM app.tenants
WHERE owner_user_id = '<qc_user_id>';
-- → record :orphan_tenant_id  (slug/name should look junk/duplicate)

-- 1d. Sanity: qc has only the one orphan membership.
SELECT m.tenant_id, m.role, m.created_at, t.name
FROM app.members m
JOIN app.tenants t ON t.id = m.tenant_id
WHERE m.user_id = '<qc_user_id>';
-- → expect a single row whose tenant_id = :orphan_tenant_id

-- 1e. Confirm orphan really is empty.
SELECT COUNT(*) AS members FROM app.members      WHERE tenant_id = '<orphan_tenant_id>';
SELECT COUNT(*) AS invites  FROM app.invitations WHERE tenant_id = '<orphan_tenant_id>';
SELECT migration_name FROM app.tenant_migrations WHERE tenant_id = '<orphan_tenant_id>';

-- 1f. Confirm the per-tenant schema name (PER_TENANT_SCHEMA_ENABLED=true
--     on prod ⇒ provisionTenant ran at signup).
SELECT nspname
FROM pg_namespace
WHERE nspname = 'tenant_' || replace('<orphan_tenant_id>'::text, '-', '_');
-- → record the exact nspname string returned (this goes into 2D below)


-- ────────────────────────────────────────────────────────────────────
-- GATES — STOP HERE if any of these are false:
--   • 1a returned exactly one row.
--   • 1b's GB tenant looks right (id starts 7a055706-, plan/status sane).
--   • 1c's orphan tenant is owned BY qc and only by qc.
--   • 1e shows: members=1, invites=0, exactly the baseline migration row.
--   • 1f returned exactly one nspname.
--
-- NOTE on query 1d: as observed on 2026-05-19, qc had TWO membership
-- rows — `admin` in GB (7a055706-…) and `owner` in the orphan "Thuy"
-- tenant (d61a2641-389c-434d-902f-403b195e9393). qc was invited into
-- GB as admin shortly after creating the orphan, so the join-to-GB
-- step is already done. The fix therefore SKIPS the INSERT in 2A and
-- only drops the orphan. If you ever re-use this script for a
-- different orphan situation where the user is NOT yet in the target
-- tenant, un-comment 2A.
-- ────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────
-- SECTION 2 — FIX (single transaction). Substitute the captured UUIDs
-- and the exact schema name from SECTION 1 before running.
--
-- Captured values (2026-05-19):
--   <qc_user_id>            = (from query 1a)
--   <gb_tenant_id>          = 7a055706-c2f4-4325-8631-2ddf42bfa6ce
--   <orphan_tenant_id>      = d61a2641-389c-434d-902f-403b195e9393
--   <exact_nspname_from_1f> = tenant_d61a2641_389c_434d_902f_403b195e9393
-- ────────────────────────────────────────────────────────────────────

BEGIN;

-- 2A. SKIPPED — qc is already an admin in GB (membership row created
--     2026-05-18 01:55:47, see query 1d output). Re-inserting would
--     violate members_tenant_user_uq and abort the transaction.
-- INSERT INTO app.members (tenant_id, user_id, role)
-- VALUES ('<gb_tenant_id>', '<qc_user_id>', 'member');

-- 2B. Drop the orphan tenant. Cascades:
--       • app.members.tenant_id     → ON DELETE CASCADE
--       • app.invitations.tenant_id → ON DELETE CASCADE
--       • app.audit_events.tenant_id → ON DELETE SET NULL
--         (the 'tenant.created' audit row is preserved with tenant_id=NULL)
DELETE FROM app.tenants WHERE id = '<orphan_tenant_id>';

-- 2C. tenant_migrations has no FK to tenants — clean its ledger row.
DELETE FROM app.tenant_migrations WHERE tenant_id = '<orphan_tenant_id>';

-- 2D. Drop the empty per-tenant schema. Use the EXACT nspname returned
--     by query 1f (do not reconstruct by hand). CASCADE is safe because
--     SECTION 1's gate confirmed the tenant was empty.
DROP SCHEMA IF EXISTS "<exact_nspname_from_1f>" CASCADE;

COMMIT;


-- ────────────────────────────────────────────────────────────────────
-- SECTION 3 — POST-FIX VERIFICATION. All four should match the
-- expected results in their trailing comments.
-- ────────────────────────────────────────────────────────────────────

-- 3a. qc now has exactly one membership, and it's the GB tenant.
SELECT m.tenant_id, m.role, t.name
FROM app.members m
JOIN app.tenants t ON t.id = m.tenant_id
WHERE m.user_id = '<qc_user_id>';
-- → exactly one row:
--     tenant_id = 7a055706-c2f4-4325-8631-2ddf42bfa6ce (German Butchery PTY LTD)
--     role      = 'admin'   ← pre-existing, untouched by this fix
--   The d61a2641-… ("Thuy") row should be gone via 2B's cascade.

-- 3b. Orphan tenant is gone.
SELECT 1 FROM app.tenants            WHERE id        = '<orphan_tenant_id>';  -- → 0 rows
SELECT 1 FROM app.tenant_migrations  WHERE tenant_id = '<orphan_tenant_id>';  -- → 0 rows
SELECT 1 FROM pg_namespace           WHERE nspname   = '<exact_nspname_from_1f>';  -- → 0 rows

-- 3c. The audit trail row remains (tenant_id nulled), proof the
--     orphan tenant ever existed.
SELECT id, action, tenant_id, actor_email, created_at
FROM app.audit_events
WHERE actor_user_id = '<qc_user_id>' AND action = 'tenant.created';
-- → 1 row, tenant_id IS NULL


-- ────────────────────────────────────────────────────────────────────
-- Tell qc to sign out and back in. Their old JWT carries
-- activeTenantId=<orphan>; currentMembership() in
-- apps/lms-web/lib/auth/current.ts:76-123 falls back to the most-recent
-- membership when the cookie's tenant has no membership row, so a fresh
-- sign-in lands them in the GB workspace.
-- ────────────────────────────────────────────────────────────────────
