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
- Employee table (`sc_employees`): name, email, mobile, department, hourly rate, availability (jsonb), employment type (`permanent` | `casual` | `labour_hire`)
- RBAC role assignment via Tracey membership (`lib/roles.ts`)
- ✅ **Magic-link signup** — workers sign up at `/sign-up` or accept invites via Tracey's `/accept-invite` on lms-web. Auto-invite from `createEmployeeAction` (#2b) drops the worker into the flow.
- ✅ **Profile completion** — `sc_employees` has DOB, address line, gender, preferred name, emergency contact name + phone columns. Manager UI on `/app/employees/[id]/edit`; worker self-edit on `/app/welcome` (shipped 2026-05-27 as audit #2 polish).
- ✅ **TFN / BSB / account / super capture** — encrypted at rest via `@tracey/db/pii` (AES-256-GCM). Columns: `tfn_enc`, `bsb_enc`, `account_number_enc`, `super_fund_name`, `super_member_number_enc` on `sc_employees`. Manager-side PII card with audit-logged reveal; worker self-save on `/app/welcome`.
- ✅ **Document upload** — `sc_documents` table with scope=`team` for per-employee certs (ID, work permit, RSA, food handling). Manager upload via `/app/people/team-documents`; worker self-upload via `/app/welcome` (shipped 2026-05-27).
- ✅ **Digital signature on documents** — `sc_document_signatures` table (audit #2c) records IP/UA/timestamp + SHA-256 hash of source. Signature flow on `/app/people/team-documents` when manager flags `requires_signature`.
- ✅ **Skills & qualifications tagging** — `sc_skills` + `sc_employee_skills` per-tenant tables (audit #8). Manager-side CRUD at `/app/admin/skills`; chip-toggle on the employee edit page.
- ✅ **Forced onboarding flow** — dashboard redirects to `/app/welcome` while `sc_employees.onboarding_status === 'pending'`. Status flips to `active` once required `sc_employee_onboarding_tasks` are done.

**Missing**
- **Bidirectional payroll sync** with Xero (push works ✅; pull-back of employee changes from Xero → ShiftCraft not implemented)
- ✅ **Employment-type vocabulary aligned** — migration `0043_shiftcraft_employment_type_vocab` renamed the legacy enum to the brief's `full_time` | `part_time` | `casual` | `contractor` (public template migration `0031` + per-tenant backfill `permanent→full_time`, `labour_hire→contractor`; `part_time` is new). Business logic carried over: `contractor` inherits the old `labour_hire` "roster-only / no LMS suggestion / never auto-invited" semantics; the zero-accrual set is now `{casual, contractor}` (full_time + part_time accrue). Surfaced across the create/edit/import forms, People > Team badges, and the detail modal.
- ✅ **Document expiry alerts** — `/app/admin/documents-expiring` admin page buckets every doc with an expiry within 30 days (or already passed) into expired / ≤7d / 8–14d / 15–30d tiers. Covers both team and library scope. One-click "Send digest now" button fans an in-app notification + best-effort email to every owner/admin (no cron; manual cadence, matching the WHS reminder pattern). Pure classifier at `lib/document-expiry.ts` covered by `tests/document-expiry.test.ts`. Sidebar entry under Admin: "Doc expiry digest".

**PII rule:** TFN / bank / super are encrypted at rest, never logged, never returned in list endpoints, masked in UI except on explicit manager reveal (which writes a `pii.revealed` audit event).

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
- ✅ **Auto-scheduler v1** — greedy CSP shipped 2026-05-25. Respects availability jsonb (existing helper), approved leave overlap, required skill (`sc_shifts.required_skill_id`), max weekly hours (40h cap), min rest (10h, AU general-rule default). Skills tagging via new `sc_skills` + `sc_employee_skills` per-tenant tables; admin CRUD at `/app/admin/skills`. UI at `/app/schedule/auto-fill` proposes assignments + lists unfilled with rejection reasons; accept = bulk-offered assignments.
- **Wage-budget guardrail per day** (no budget column on `sc_locations` or `sc_shifts`) — deferred.
- **POS sales-forecast input** to drive staffing levels per hour (deferred for v1 per scope clarification — manual daily sales entry instead)
- ✅ **Publish-time push notification** — push fan-out from `createNotifications` covers this (audit #12).
- **Change-after-publish alerts** to affected staff (email + push exist; SMS missing — see #11)

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

### Feature 5 — Payroll export · 🟡

**Implemented**
- ✅ **Xero adapter shipped** 2026-05-25 — `xero-node` SDK, per-tenant OAuth 2.0 connection (one Xero org per workspace) with encrypted access/refresh tokens (AES-256-GCM via `@tracey/db/pii`), auto-refresh on every call.
- ✅ **Earnings-code mapping** — `sc_xero_earnings_mapping` per-tenant table; admin UI at `/app/admin/payroll` lets owner map each ShiftCraft category (`ordinary` · `overtime` · `penalty_sat` · `penalty_sun` · `penalty_ph` · `penalty_night` · `allowance`) to a Xero `EarningsRate` ID. Pre-export validation lists every category the week actually uses against the mapping, fails fast if any are unmapped.
- ✅ **Employee linking** — `sc_xero_employee_links` per-tenant table; admin maps each `sc_employees.id` to a Xero `EmployeeID`. Unlinked employees are skipped on export with a friendly warning (one failed link doesn't block the rest).
- ✅ **Draft pay-run creation** — `/app/admin/payroll` "Send timesheets to Xero" form classifies the week via the existing award classifier, builds per-(employee, week) Xero Timesheets with per-day unit arrays, pushes via `payrollAUApi.createTimesheet` at status `APPROVED`. The Xero admin finalises the pay run in Xero.
- ✅ **Idempotency** — `sc_xero_pay_runs` ledger unique on (tenant, week_start). Re-export upserts the same row with a fresh idempotency key. CSV export at `app/api/timesheets/export/route.ts` remains as a fallback.
- ✅ **Post-finalisation pull-back** — admin pastes the Xero `PayRunID` into the read-back form; `payrollAUApi.getPayRun` totals (gross / net / tax / super) persist into `sc_xero_pay_runs.summary` for the Reports page.

**Missing / deferred**
- **Per-employee export status** in `/app/timesheets` — the export ledger row exists but the row-level UI surfacing it is a v2 polish.
- **Multi-org chooser** — current flow grabs the first Xero org returned by `/connections`; multi-org admins get whichever Xero defaulted to.
- **Overtime-on-a-penalty-day at a separate rate** — v1 semantics: on Sat/Sun/PH days, all worked minutes (including OT) flow into the day's penalty bucket. Splitting OT-on-penalty needs the classifier to emit a combo category — explicit follow-up.
- **MYOB / ADP / Gusto / QuickBooks adapters** — interface is provider-shaped (`lib/payroll/*`) so they can slot in; not implemented yet.

**Hard rule reaffirmed:** ShiftCraft never calculates tax / super / payslips. Hours + interpreted pay categories handed off to Xero; Xero finalises and ShiftCraft reads back.

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

- ✅ **AU accrual rules** — `sc_leave_types.accrual_rate_per_hour` per-tenant column (numeric 8,6). Seeded defaults: annual 0.076923 (4/52), personal_sick 0.038462 (2/52), unpaid + other null, long_service 0. Admin tunable via `/app/admin/leave-types`. Casual + labour_hire employees get zero accrual regardless of rate (paid-leave loading already in the hourly rate per AU general rule).
- ✅ **Balance display** — running per-type balance card on `/app/time-off`. Accrued = ordinary hours from approved timesheets × rate. Taken = business-days × 7.6h from approved time-off. Negative balance is informational (admins decide; doesn't block submission).
- ✅ **Calendar view** — `/app/calendar` month grid combining approved leave (solid coloured chips), pending leave (dashed border), accepted shifts (emerald pill), and AU public holidays (purple PH chip). Admin picks any employee via dropdown; workers see their own.

- ✅ **Auto-decline of overlapping offered/accepted assignments** on approval — `approveTimeOffAction` now reads the affected-shift list (same helper that drives the admin-facing Impact disclosure), flips each overlapping `offered`/`accepted` assignment to `declined` in the same tx as the approval, audits with the count, and notifies the worker per shift (in-app + push). Tests in `tests/time-off-approve-auto-decline.test.ts`.

**Missing**
- (none for Feature 6 in scope; bidirectional Xero payroll-sync still belongs to Feature 1/5.)

---

### Feature 7 — Reporting / labour-cost analytics · 🟡

**Implemented**
- Dashboard at `/app/reports`: hours, headcount, basic cost lines
- Audit viewer at `/app/audit`
- Notifications feed at `/app/notifications`
- ✅ **Hours by employee / department / location** rollups with week navigation + department filter
- ✅ **CSV export** of the per-week report
- ✅ **Wages vs sales** — `sc_daily_sales` per-tenant table + manual entry at `/app/admin/daily-sales` (week grid by location, inline edit, soft-archive via Clear); `/app/reports` shows gross sales / actual wage cost / labour-cost % with week-over-week comparison (lower = greener)
- ✅ **Schedule cost vs actual cost variance** — sums accepted+published shifts × employee rate, compares against actual clocked-hour cost; surfaces +/- $ and % over/under scheduled
- ✅ **Attendance scoreboard** — `/app/reports/attendance` surfaces per-employee scheduled, no-shows, late arrivals (count + avg minutes past a 5-min grace), and unapproved overtime (work past shift end + 15-min grace, gated by `sc_timesheet_approvals` status). Period picker (7/30/60/90d) and location filter. Approving a week in `/app/timesheets` removes its OT from the column. Pure aggregator at `lib/attendance-scoreboard.ts` covered by `tests/attendance-scoreboard.test.ts`.
- ✅ **Hours by role rollup** — `/app/reports` "Hours by role" section sums scheduled hours from accepted+published shifts keyed by `sc_shifts.role`, with distinct headcount and week-over-week delta. Free-text roles (e.g. "Butcher", "Cashier") bucket directly; empty roles fall into "Unassigned". Note: roles aren't broken out for *actual* clock hours because `sc_clock_events` doesn't carry a role — Hours-by-employee remains the actuals view.

**Missing**
- **Read-back of finalised payroll gross/net** (depends on Feature 5)
- **Award-derived wages-vs-sales variant** — current card uses base rate × hours; the OT/penalty-aware variant would reuse the classifier shipped in #3b

---

## 4. Cross-cutting infra

| Capability | Status | Where / why |
|---|---|---|
| RBAC (Owner/Manager/Employee) | ✅ | `apps/shiftcraft-web/lib/roles.ts` maps ShiftCraft roles to Tracey `owner/admin/member` |
| Row-level access by location | ✅ | Per-tenant `sc_manager_locations` maps admins to location sets. Owners + unscoped admins keep full access; admins with 1+ rows are scoped on `/app/schedule`, `/app/schedule/[id]/edit`, `/app/coverage-gaps`, and the create/update shift actions. Owner-only admin page at `/app/admin/manager-scopes`. Timesheets/reports stay tenant-wide for v1 (cross-location aggregates by design). |
| Audit log on sensitive writes | ✅ | `apps/shiftcraft-web/lib/audit.ts` → shared `app.audit_events` table; **extend, do not parallel** |
| In-app notifications | ✅ | `lib/notifications.ts` (`createNotifications`, `notifyTenantAdmins`) → shared `app.notifications` |
| Email notifications | ✅ | Resend; `lib/email.ts` degrades to no-op when key missing — **confirm desired in prod** |
| Email unsubscribe / prefs | ✅ | `sc_email_unsubscribes` (schema line 530), `lib/email-prefs.ts`, test `tests/email-prefs.test.ts` |
| SMS notifications | ❌ | Not present. Magic-link invite + shift-change alerts need SMS. Carrier choice pending (Twilio / MessageBird / AWS SNS). |
| Push notifications | ✅ | Web push (VAPID + `web-push` lib) wired into `createNotifications` so every in-app notification fans out a push too. Per-(user, browser) `sc_push_subscriptions` rows; 410 Gone / 404 auto-prune. Opt-in toggle at `/app/settings`; service worker at `public/sw.js`. Native mobile path still TBD. |
| Multi-tenant isolation | ✅ | Per-tenant Postgres schema + `forTenant(tid).run(tx => …)` (`packages/db/src/client.ts`) + RLS migration written (not yet enabled per memory) |
| Multi-location | ✅ | `sc_locations` per tenant (tz, accent colour) — schema line 51 |
| Localisation | ❌ | Hardcoded English. Acceptable for AU-only v1; use `Intl` for date/currency. |
| Webhooks (outbound) | ✅ | Per-tenant `sc_webhook_subscriptions` + `sc_webhook_deliveries`. Three events ship today: `timesheet.approved` · `employee.created` · `shift.published`. `payroll.exported` lands when the Xero adapter (Feature 5) does. HMAC-SHA256 signing via `X-Webhook-Signature`. Admin CRUD + delivery log + retry-on-failure at `/app/admin/webhooks`. |
| PII encryption at rest | ✅ | AES-256-GCM via `@tracey/db/pii` (`encryptPii` / `decryptPii`). Used by `sc_employees` (TFN/BSB/account/super) and `sc_xero_connections` (OAuth tokens). `TRACEY_PII_ENC_KEY` env var required. |
| Encryption at rest helper | ✅ | `@tracey/db/pii` ships AES-256-GCM with `v1:` versioned tokens, random IV per encrypt, base64-encoded ciphertext+tag. Decrypt throws on tampered or malformed input. |

---

## 5. Recommended Phase 2 build order

Dependency-ordered so each item unblocks the next. Sizing: S < ~1 day, M ~1-3 days, L > 3 days. Each ships as **one small PR with: migration + model + actions + UI + happy-path test + short `FEATURE.md`**, and flips this AUDIT.md status to ✅.

1. **PII envelope-encryption helper** (S) — `pgcrypto` wrapper in `@tracey/db`, KMS key in env. Unblocks #2 + #5.
2. **Onboarding completion** (M) — magic-link signup (email-first; SMS deferred to #11), profile-completion form (DOB / address / emergency contact / TFN / super / bank — encrypted), document upload (cross-reference `packages/storage` from planning lineage), e-sign PDF + IP/UA/timestamp audit trail. Skills tagging deferred to #8.
3. **AU public-holiday calendar + rate interpreter** (M) — new `packages/award`, pure functions, unit-test heavy. Per-region holiday table. Unblocks #4, #6 accrual, #9 variance.
4. **Timesheet derivation upgrade** (S) — wire interpreter into existing approval flow, display derived OT/penalty/allowance lines, lock approved timesheets behind audit-tracked reopen.
5. **Xero payroll adapter** (M) — ✅ shipped 2026-05-25. `xero-node` + OAuth + 4 per-tenant tables (connections, earnings mapping, employee links, pay-run ledger) + admin UI + draft pay-run export from approved week's classifier output + read-back of finalised totals. Prod needs three env vars (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`) from a developer.xero.com app registration. MYOB/ADP/Gusto/QuickBooks adapters slot in later via the same interface shape.
6. **Leave types + accrual + roster-clash guard** (S) — ✅ catalogue + clash guard shipped 2026-05-25; accrual + balance card + calendar shipped 2026-05-26; auto-decline of overlapping assignments on approval shipped 2026-05-27.
7. **Geofence + selfie clock-in** (M) — wire the existing `geofence` enum: mobile-web GPS first, `geofence_radius_m` on `sc_locations`, selfie via getUserMedia → object storage. Offline sync deferred until customers ask.
8. **Auto-scheduler v1** (M-L) — ✅ shipped 2026-05-25. Greedy generator + `/app/schedule/auto-fill` UI + `sc_skills` + `sc_employee_skills` per-tenant tables + `required_skill_id` on `sc_shifts`. Constraints respected: availability jsonb, approved leave, required skill, 40h weekly cap, 10h min rest. Wage-budget guardrail + POS forecast slot still deferred; skills-tagging on `sc_shift_templates` also deferred (manager picks the skill when stamping a template onto a date).
9. **Reporting deepening** (S-M) — ✅ sc_daily_sales + wages-vs-sales + schedule-vs-actual variance + per-location/department rollups + CSV downloads shipped 2026-05-25; attendance scoreboard + per-role rollup shipped 2026-05-27. Only payroll cost read-back (depends on Feature 5) remains.
10. **Webhooks** (S) — ✅ shipped 2026-05-25. Three events live (`timesheet.approved` · `employee.created` · `shift.published`); HMAC-SHA256 signing; admin-triggered retry on failure. Background retry-with-backoff still deferred.
11. **SMS notifications** (S) — carrier choice (Twilio / MessageBird / AWS SNS); add to fan-out in `lib/notifications.ts`.
12. **Web push** (S) — ✅ shipped 2026-05-25. VAPID + `web-push` library, per-(user, browser) subscriptions with 410-Gone auto-prune. Fans out from `createNotifications` so existing in-app notifications also light up the browser. Native mobile path remains TBD.
13. **Location-level RBAC tightening** (S) — ✅ shipped 2026-05-25. `sc_manager_locations` per-tenant table + owner-only `/app/admin/manager-scopes` UI; `/app/schedule` + edit-shift + `/app/coverage-gaps` filter by scope, and create/update actions reject cross-scope writes. Timesheets + reports remain tenant-wide aggregates (intentional).

---

## 6. Open clarifications (need answers before the matching slice starts)

These do **not** block AUDIT.md acceptance. They block specific Phase 2 slices.

- **#2 onboarding:** email-magic-link only, or email + SMS at parity from v1?
- **#2 onboarding:** reuse `packages/storage` (planning Slice 7's local-fs + R2 adapter) for documents, or stand up a ShiftCraft-specific bucket?
- ✅ **#2 onboarding:** employment-type vocabulary resolved — the brief's `full_time / part_time / casual / contractor` won (migration 0043, 2026-05-29).
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
