# ShiftCraft — Phase 1 Audit

**Scope:** What exists today in `apps/shiftcraft-web` (and the shared `packages/*`) against the 7-feature ShiftCraft brief. Honest status, no aspirational claims.

**Method:** Read-only walk of the `LMS-1-shiftcraft` worktree on branch `shiftcraft/session-2026-05-13` at commit `e65b042`. Every claim below cites a file path so you can spot-check.

**Result:** ShiftCraft is **not greenfield**. Significant scaffolding is in place — schema, RBAC, audit, in-app notifications, email, multi-tenancy, multi-location, shift CRUD, swaps, open shifts, kiosk clock, time-off, basic reports. The gaps are concentrated in: payroll-grade interpretation, payroll export, auto-scheduling, PII capture/encryption, geofence, and outbound integrations (webhooks, SMS, push).

**Scope clarifications captured for Phase 2:**
- Target country: **Australia** (Modern Award interpretation, AU public holidays, super, TFN)
- First payroll adapter: **Xero**
- POS sales-forecast: **deferred** — v1 uses manual daily sales entry; POS adapter ships only when a real customer needs it

---

## 1. Stack snapshot

| Layer | Choice | Evidence |
|---|---|---|
| Monorepo | pnpm 9.15 workspaces + Turbo | root `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| Frontend | Next.js 16 App Router + React 19 RSC | `apps/shiftcraft-web/package.json` (`next@^16.0.0`, `react@^19.0.0`) |
| Styling | Tailwind v4 + shadcn/ui (Radix + CVA) | `tailwindcss@^4.0.0`, `@tailwindcss/postcss@^4.0.0`, `@radix-ui/react-*`, local `components/ui/*` |
| Forms / validation | Zod 3.24 + server actions, custom `FormState` shape | `zod@^3.24.1`; pattern in every `app/app/**/actions.ts` |
| ORM | Drizzle 0.38 (`drizzle-orm`, `drizzle-kit`) | `drizzle-orm@^0.38.3`; `packages/db/drizzle.config.shiftcraft.ts` |
| DB | Postgres on Render `lms-db`, per-tenant schema (`SET search_path` + RLS planned) | `packages/db/src/client.ts` (`forTenant(tid).run(...)`); `packages/db/migrations/manual/0004_enable_rls.sql` (written, **not yet applied** per memory) |
| Auth | NextAuth v5 beta + Drizzle adapter + bcryptjs | `next-auth@5.0.0-beta.25`, `@auth/drizzle-adapter@^1.7.4`, `bcryptjs@^2.4.3`, `auth.config.ts` |
| Email | Resend v4 with graceful no-op when key missing | `resend@^4`, `apps/shiftcraft-web/lib/email.ts` |
| Tests | Vitest 2.1 | `vitest@^2.1.8`, 19 specs in `apps/shiftcraft-web/tests/` |
| Drag-and-drop | `@dnd-kit/core`, `@dnd-kit/sortable` | shift-template ordering, schedule UI |
| Icons | `lucide-react` | sidebar + nav |
| Node | ≥ 20.11 | root `package.json#engines` |
| Dev port | 4100 (`with-env.mjs dev -p 4100`) | `apps/shiftcraft-web/package.json#scripts.dev` |

**Notable absences in `package.json`** (would mark new build slices):
- No Xero / MYOB / ADP / Gusto / QuickBooks SDK
- No Twilio / MessageBird / AWS SNS for SMS
- No web-push / VAPID
- No PDF e-sign library
- No object-storage SDK in shiftcraft-web itself (R2 / S3) — planning lineage has a storage adapter; reach across before adding here
- No i18n library (acceptable for AU-only v1; use `Intl` directly)

---

## 2. Repo conventions to match in Phase 2

- **File naming:** kebab-case folders (`shift-templates`, `time-off`, `open-shifts`). Pages: `page.tsx`. Mutations: co-located `actions.ts`.
- **Mutations:** `"use server"` actions only. `/api/*` is reserved for external endpoints (NextAuth callback, iCal, CSV export).
- **Action shape:** `Zod parse → currentMembership() role check → forTenant(tid).run(async (tx) => …) → logAuditEvent(...) → createNotifications(...) → return FormState`. Errors caught, mapped to `FormState.error` + `fieldErrors`.
- **DB:** `sc_*` table prefix, `tracey_tenant_id text not null` on every per-tenant row, `created_at` / `updated_at` with timezone, FKs `on delete cascade` or `set null`, indexes on `(tracey_tenant_id, …)`.
- **Schema source-of-truth:** `packages/db/src/shiftcraft-schema.ts` for public template + Drizzle codegen. `packages/db/migrations/per-tenant/0011_shiftcraft_baseline.sql` materialises the public template inside each tenant schema with `CREATE TABLE … (LIKE public.sc_* INCLUDING ALL)`.
- **Migrations:** Drizzle-generated for the public template (`migrations-shiftcraft/`); hand-written SQL for per-tenant + manual operator slices (`migrations/per-tenant/`, `migrations/manual/`).
- **No new dependencies** without explicit approval.
- **One commit per session**, itemised body. **No push** until "push it".
- **No emojis** in committed files or commit messages unless explicitly requested.

---

## 3. Feature audit

Legend: ✅ Implemented · 🟡 Partial · ❌ Missing.

### Feature 1 — Employee onboarding · 🟡

**Implemented**
- Manual create-employee form: `apps/shiftcraft-web/app/app/employees/new/page.tsx` + `actions.ts`
- Edit role / rate / location: `app/app/employees/[id]/edit/page.tsx`
- Employee table (`sc_employees`): name, email, mobile, department, hourly rate, availability (jsonb), employment type (`permanent` | `casual` | `labour_hire`) — `packages/db/src/shiftcraft-schema.ts:270-317`
- RBAC role assignment via Tracey membership (`lib/roles.ts`)

**Missing**
- Magic-link self-signup (email **or** SMS) — Tracey has invite-by-email at `/app/members` (per memory) but ShiftCraft-specific worker onboarding is not wired
- Profile completion screen: **DOB, residential address, emergency contact** — no columns on `sc_employees`
- **TFN capture** (encrypted at rest) — no column, no encryption helper
- **Banking** (BSB + account) encrypted at rest — no column
- **Super fund** capture — no column (research-only doc at `apps/shiftcraft-web/docs/ato-integration-research.md` covers stapled-super lookup; not actioned)
- **Document upload**: photo ID, work permit/visa, role-specific certs (RSA, food handling) — no storage wiring in this app (planning lineage has `packages/storage`; not exposed to shiftcraft-web)
- **Digital signature on employment contract** + signed PDF + audit trail (who/when/IP)
- **Skills & qualifications tagging** for the (future) auto-scheduler
- **Bidirectional payroll sync** — depends on Feature 5
- **Employment-type vocabulary mismatch** — schema uses `permanent` | `casual` | `labour_hire`; brief calls for `full_time` | `part_time` | `casual` | `contractor`. Pick one and migrate.

**PII rule reminder for Phase 2:** TFN / bank / super must be encrypted at rest (envelope encryption), never logged, never returned in list endpoints, masked in UI except on explicit reveal.

---

### Feature 2 — Scheduling / rostering · 🟡

**Implemented**
- Shift CRUD with role, location, start/end, break allowance, notes, status (`draft` | `published` | `cancelled`): `app/app/schedule/*`, schema at `packages/db/src/shiftcraft-schema.ts:81-117`
- Calendar / list view on `/app/schedule` with bulk publish + duplicate-week
- Shift templates (reusable patterns): `app/app/shift-templates/*`, schema at line 566
- Shift assignments: `sc_shift_assignments` (line 118)
- Open shifts (qualified staff can claim): `app/app/open-shifts/*`
- Shift swap / cover marketplace with pending → accepted/declined → cancelled lifecycle: `app/app/swaps/*`, schema at line 192
- Coverage-gaps view: `app/app/coverage-gaps/page.tsx`
- Email notification on swap activity: `lib/email.ts`
- iCal export per user (so staff see shifts in their device calendar): `/api/calendar/[tenant]/[user]/[token]`, `lib/ics.ts`

**Missing**
- **Auto-scheduler** that respects:
  - Employee availability + approved leave (leave exists; availability JSON exists; algorithm missing)
  - Required skills / qualifications per shift (no skills tagging exists yet)
  - Max weekly hours, min rest between shifts, fatigue rules
  - Wage-budget guardrail per day (no budget column on `sc_locations` or `sc_shifts`)
- **POS sales-forecast input** to drive staffing levels per hour (deferred for v1 per scope clarification — manual daily sales entry instead)
- **Publish-time push notification** (push channel missing — see §4)
- **Change-after-publish alerts** to affected staff (email exists; push/SMS missing)

---

### Feature 3 — Time & attendance · 🟡

**Implemented**
- Append-only clock-event stream (`sc_clock_events`) with `event_type` in {`in`, `break_start`, `break_end`, `out`}: `packages/db/src/shiftcraft-schema.ts:339-385`
- Source enum recognises `manual` | `kiosk` | `geofence` | `admin_edit` (line 370)
- Derived state ("currently clocked in", "on break", "elapsed today", "hours this week") computed by walking the stream: `apps/shiftcraft-web/lib/clock.ts`
- Manual clock-in/out UI + manager manual entry: `app/app/clock/*`
- Real-time "who's in" surface (per location) on `/app/clock`
- Late / no-show detection vs schedule: present in reports / coverage-gaps surfaces

**Missing**
- **Mobile GPS path** — `geofence` is in the enum and called out in the schema comment as a future integration, but no client code, no geofence radius column on `sc_locations`, no location-permission UI
- **Kiosk selfie** at each punch — `device_id` / `photo_url` columns absent on `sc_clock_events`
- **Offline capture + reconnect sync** — no service worker, no client-side queue, no idempotency keys
- **Edit-with-reason audit trail** — schema comment foresees `corrects_event_id` + `reason` columns; not yet added (audit-events table catches the action either way)

---

### Feature 4 — Timesheet + award / rate interpretation · 🟡

**Implemented**
- Timesheet approval workflow per period (manager `approved` / `disputed`): `app/app/timesheets/*`, schema `sc_timesheet_approvals` (line 481)
- CSV export of raw hours: `app/api/timesheets/export/route.ts`
- Discrepancy view (scheduled vs actual) surfaced in `/app/timesheets`
- Employee `hourly_rate` numeric on `sc_employees`
- Audit log on approve / dispute via `lib/audit.ts`

**Missing — this is the biggest single gap**
- **Rules engine** for ordinary vs overtime (daily + weekly thresholds)
- **Penalty rates** (weekend / evening / public holiday)
- **Allowances** (per-shift, per-hour, flat)
- **Paid vs unpaid breaks** logic
- **AU public-holiday calendar** per region (no table, no seed)
- **Auto-generated period timesheet** from `sc_clock_events` rows (export is raw; no derived pay lines)
- **Lock approved timesheets** behind an audit-tracked reopen
- **Modern Award alignment** — required for accurate AU pay (see Feature 1's encryption + Feature 5's earnings codes; these connect)

Recommended Phase 2 housing: new `packages/award` package with a pure rules engine, unit-test heavy. Keeps Next.js out of the test loop.

---

### Feature 5 — Payroll export · ❌

**Implemented**
- Nothing payroll-provider-specific
- CSV export at `app/api/timesheets/export/route.ts` (useful as a fallback / sanity check, not a substitute)

**Missing**
- Adapter interface (`packages/payroll-export` with one module per provider; Xero ships first per scope clarification)
- Tenant-level **earnings-code mapping** (ordinary / OT / penalty / allowance → provider code)
- **Draft pay-run creation** in the provider; manager finalises there
- **Idempotency** — re-running export does not duplicate
- **Per-employee export status** visible in `/app/timesheets`
- **Post-finalisation pull-back** of gross/net summary so `/app/reports` shows actual wage cost (read-only)

**Hard rule for Phase 2:** ShiftCraft never calculates tax / super / payslips. Hours + interpreted pay categories handed off to Xero; Xero finalises and ShiftCraft reads back.

---

### Feature 6 — Leave management · 🟡

**Implemented**
- Request → approve / deny lifecycle: `app/app/time-off/*`, schema `sc_time_off_requests`
- Reviewer + reviewed-at tracked
- Status enum: `pending` | `approved` | `denied` | `cancelled`
- Email + in-app notification on state changes (`lib/email.ts`, `lib/notifications.ts`)
- Audit log on every transition
- ✅ **Leave-type catalogue** — `sc_leave_types` (per-tenant), seeded with `annual` · `personal_sick` · `unpaid` · `long_service` · `other`. Admin CRUD at `/app/admin/leave-types`; rename + archive + add-custom + delete-if-unused. FK on `sc_time_off_requests.leave_type_id` (ON DELETE RESTRICT). Slug-derived stable keys keep seeded rows referenceable from code even when admins rename them.
- ✅ **Roster-clash guard** — schedule actions (`assignEmployeeAction`, `bulkOfferShiftAction`, `claimShiftAction` in open-shifts) refuse to roster a worker whose APPROVED leave overlaps the shift window. Bulk-offer surfaces a separate `Skipped N on approved leave` counter in the success banner.
- ✅ **Public-holiday overlap warning** on time-off requests (informational chip; doesn't change accrual yet)

**Missing**
- **AU accrual rules** per employment type, accruing on approved hours (depends on Feature 4 interpreter)
- **Balance display** per leave type
- **Calendar view** of leave alongside roster (single combined month view)
- **Auto-decline of overlapping offered/accepted assignments** when a leave request is approved post-offer (today the admin sees the impact list and decides manually)

---

### Feature 7 — Reporting / labour-cost analytics · 🟡

**Implemented**
- Dashboard at `/app/reports` (~25KB page component): hours, headcount, basic cost lines
- Audit viewer at `/app/audit`
- Notifications feed at `/app/notifications`

**Missing**
- **Wages vs sales** per day / per hour — no sales table; brief defers POS; minimum needed is a manual `sc_daily_sales` table per tenant
- **Schedule cost vs actual cost variance** (needs Feature 4 interpreter)
- **Hours by employee / role / location** rollups with date range
- **Attendance scoreboard**: lateness, no-shows, unapproved overtime
- **CSV export** of any report (only timesheets + schedule have it today)
- **Read-back of finalised payroll gross/net** (depends on Feature 5)

---

## 4. Cross-cutting infra

| Capability | Status | Where / why |
|---|---|---|
| RBAC (Owner/Manager/Employee) | ✅ | `apps/shiftcraft-web/lib/roles.ts` maps ShiftCraft roles to Tracey `owner/admin/member` |
| Row-level access by location | 🟡 | Tenant isolation is solid; **location-level scoping is not enforced** (a Manager at Location A can today see shifts at Location B). Tighten in Phase 2. |
| Audit log on sensitive writes | ✅ | `apps/shiftcraft-web/lib/audit.ts` → shared `app.audit_events` table; **extend, do not parallel** |
| In-app notifications | ✅ | `lib/notifications.ts` (`createNotifications`, `notifyTenantAdmins`) → shared `app.notifications` |
| Email notifications | ✅ | Resend; `lib/email.ts` degrades to no-op when key missing — **confirm desired in prod** |
| Email unsubscribe / prefs | ✅ | `sc_email_unsubscribes` (schema line 530), `lib/email-prefs.ts`, test `tests/email-prefs.test.ts` |
| SMS notifications | ❌ | Not present. Magic-link invite + shift-change alerts need SMS. Carrier choice pending (Twilio / MessageBird / AWS SNS). |
| Push notifications | ❌ | Not present. Web-push minimum; native mobile path TBD. |
| Multi-tenant isolation | ✅ | Per-tenant Postgres schema + `forTenant(tid).run(tx => …)` (`packages/db/src/client.ts`) + RLS migration written (not yet enabled per memory) |
| Multi-location | ✅ | `sc_locations` per tenant (tz, accent colour) — schema line 51 |
| Localisation | ❌ | Hardcoded English. Acceptable for AU-only v1; use `Intl` for date/currency. |
| Webhooks (outbound) | ❌ | Not present. Need at minimum: `timesheet.approved`, `employee.created`, `shift.published`, `payroll.exported`. |
| PII encryption at rest | ❌ | No envelope-encryption helper. **Blocker for onboarding** completion (TFN / bank / super). |
| Encryption at rest helper | ❌ | No `pgcrypto` wrapper in `@tracey/db`. Build this first. |

---

## 5. Recommended Phase 2 build order

Dependency-ordered so each item unblocks the next. Sizing: S < ~1 day, M ~1-3 days, L > 3 days. Each ships as **one small PR with: migration + model + actions + UI + happy-path test + short `FEATURE.md`**, and flips this AUDIT.md status to ✅.

1. **PII envelope-encryption helper** (S) — `pgcrypto` wrapper in `@tracey/db`, KMS key in env. Unblocks #2 + #5.
2. **Onboarding completion** (M) — magic-link signup (email-first; SMS deferred to #11), profile-completion form (DOB / address / emergency contact / TFN / super / bank — encrypted), document upload (cross-reference `packages/storage` from planning lineage), e-sign PDF + IP/UA/timestamp audit trail. Skills tagging deferred to #8.
3. **AU public-holiday calendar + rate interpreter** (M) — new `packages/award`, pure functions, unit-test heavy. Per-region holiday table. Unblocks #4, #6 accrual, #9 variance.
4. **Timesheet derivation upgrade** (S) — wire interpreter into existing approval flow, display derived OT/penalty/allowance lines, lock approved timesheets behind audit-tracked reopen.
5. **Xero payroll adapter** (M) — adapter interface in `packages/payroll-export`, Xero implementation first (MYOB/ADP/Gusto/QuickBooks slot in later). Tenant-level earnings-code mapping. Idempotent draft pay-run. Pull-back gross/net.
6. **Leave types + accrual + roster-clash guard** (S) — ✅ catalogue + clash guard shipped 2026-05-25; accrual on approved hours + balance UI still deferred (depends on Feature 4 interpreter).
7. **Geofence + selfie clock-in** (M) — wire the existing `geofence` enum: mobile-web GPS first, `geofence_radius_m` on `sc_locations`, selfie via getUserMedia → object storage. Offline sync deferred until customers ask.
8. **Auto-scheduler v1** (M-L) — constraint-satisfaction draft: respect availability, leave, skills (introduce `sc_skills` + `sc_employee_skills` here), max hours, min rest, wage budget. POS forecast slot reserved but unused.
9. **Reporting deepening** (S-M) — `sc_daily_sales` manual entry, wages-vs-sales card, schedule-vs-actual variance, per-role/location hour rollups, CSV downloads, payroll cost read-back.
10. **Webhooks** (S) — outbound delivery with retries + signed payloads; per-tenant subscriptions.
11. **SMS notifications** (S) — carrier choice (Twilio / MessageBird / AWS SNS); add to fan-out in `lib/notifications.ts`.
12. **Web push** (S) — service worker + VAPID; reuse notifications fan-out.
13. **Location-level RBAC tightening** (S) — enforce per-location scope on Manager queries (called out in §4 as 🟡).

---

## 6. Open clarifications (need answers before the matching slice starts)

These do **not** block AUDIT.md acceptance. They block specific Phase 2 slices.

- **#2 onboarding:** email-magic-link only, or email + SMS at parity from v1?
- **#2 onboarding:** reuse `packages/storage` (planning Slice 7's local-fs + R2 adapter) for documents, or stand up a ShiftCraft-specific bucket?
- **#2 onboarding:** which employment-type vocabulary wins — the brief's `full_time / part_time / casual / contractor` or the existing schema's `permanent / casual / labour_hire`?
- **#5 Xero:** one Xero org per tenant, or per location?
- **#5 Xero:** ship a sensible AU default earnings-code mapping, or require admin to configure on first export?
- **#11 SMS:** carrier — Twilio, MessageBird, AWS SNS, or defer?
- **General:** keep `lib/email.ts` silent-degradation in prod (current behaviour) or hard-fail on missing key?

---

## 7. Out-of-scope for this audit

This document **does not**:
- Change any code
- Add any dependency
- Run any migration
- Commit anything (the audit doc itself awaits your green light)
- Promise a native mobile app — v1 is mobile-web
- Promise tax / super / payslip math inside ShiftCraft — Xero owns that

---

## 8. Verification commands (run from `LMS-1-shiftcraft`)

```powershell
# AUDIT.md is the only change
git status

# Stack still builds untouched
pnpm --filter shiftcraft-web typecheck
pnpm --filter shiftcraft-web test
pnpm --filter shiftcraft-web build

# Schema introspection (sanity-check the 14 sc_* tables this doc cites)
pnpm --filter @tracey/db drizzle:generate-shiftcraft  # should produce no diff vs migrations-shiftcraft/
```

---

## 9. Decision required

**Approve this audit?** If yes, I'll begin Phase 2 at item #1 (PII envelope-encryption helper). If no, tell me which sections need re-work.

**Reminder:** every Phase 2 slice ships as one small PR, on `shiftcraft/session-2026-05-13`, one commit, never merged to `main`, never pushed until you say "push it".
