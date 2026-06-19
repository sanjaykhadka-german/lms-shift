# Xero payroll export — push recorded shift hours to Xero

ShiftCraft interprets clocked time into pay categories and pushes the resulting
**hours per earnings rate** to Xero Payroll (AU) as timesheets. Xero finalises
the pay run and computes tax, super and net pay.

> **Hard boundary:** ShiftCraft never calculates tax, super, or payslips. It
> sends interpreted hours; Xero owns the money math. The only thing read back is
> the finalised totals (for the Reports page).

## Pieces

| Concern | File |
|---|---|
| Adapter (OAuth, refresh, reads, push) | `lib/payroll/xero.ts` |
| Category math (minutes → category hours → Xero lines) | `lib/payroll/categories.ts` |
| Idempotency key (pure, testable) | `lib/payroll/idempotency.ts` |
| Export / approve+export / read-back actions | `app/app/timesheets/xero-actions.ts` |
| Connect / map / link admin actions | `app/app/admin/payroll/actions.ts` |
| OAuth callback | `app/api/payroll/xero/callback/route.ts` |
| Tables (per-tenant, RLS) | `packages/db/migrations/per-tenant/0041_shiftcraft_xero.sql` |

Tables: `sc_xero_connections` (encrypted tokens + active org), `sc_xero_earnings_mapping`
(category → Xero earnings rate), `sc_xero_employee_links` (`sc_employees.id` → Xero
employee id), `sc_xero_pay_runs` (export ledger; unique on `(tenant, week_start)`;
`summary` jsonb holds per-employee results + read-back totals).

## Setup

### Environment (Render → service → Environment)
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` — from a developer.xero.com app (web app, OAuth 2.0).
- `XERO_REDIRECT_URI` — the full `…/api/payroll/xero/callback` URL, also registered on the Xero app.
- `TRACEY_PII_ENC_KEY` — AES-256-GCM key; encrypts the stored OAuth tokens.
- Scopes (default, override via `XERO_SCOPES`): `openid email profile payroll.payruns
  payroll.timesheets payroll.employees payroll.settings offline_access`.

### In the Xero organisation (Payroll AU)
- Payroll (AU) enabled with **at least one pay calendar** (e.g. weekly) — the export
  fails fast if none exists.
- **Employees** created in Xero Payroll, each **assigned to a pay calendar**. ShiftCraft
  links to existing Xero employees; it does not create them. A linked employee with no
  pay calendar is skipped on export with a clear reason.
- **Earnings rates** under Payroll settings → Pay Items → Earnings, one per category you
  export. The multiplier lives on the Xero rate — ShiftCraft only sends hours.

## Day-to-day flow (Admin → Payroll, then Timesheets)
1. **Connect Xero** and choose the org (multi-org connections offer a chooser).
2. **Auto-map earnings** + **auto-link employees**, then fix any leftovers by hand.
3. On **Timesheets**, approve the week, then **Send timesheets to Xero**
   (`exportToXeroAction`, or `approveWeekAndExportAction` for one click).
4. Finalise the pay run in Xero.
5. **Read-back:** the page lists recent Xero pay runs (`listPayRuns` → `getPayRuns`);
   click **Read back** on one to pull gross/net/tax/super into
   `sc_xero_pay_runs.summary` for Reports (`readbackPayRunAction`). Xero's UI never
   exposes the `PayRunID` GUID, so the picker is the primary path; a manual
   PayRunID field remains as a fallback (`<details>`).

### Pre-flight (export fails fast, naming what to fix)
Xero configured → valid week → manager/owner → Xero connected → ≥1 pay calendar in the
org → ≥1 employee linked → every used category mapped. Per employee, anyone unlinked or
without a Xero pay calendar is skipped (named in the result), so a partial run never goes
out silently. The `/app/timesheets` page shows a per-employee "Xero ✓ / ✗" chip read from
the ledger summary.

## Idempotency
The idempotency key hashes the timesheet payload:
`sc-{tenant8}-{week}-{sha256(payload)[:12]}` (`lib/payroll/idempotency.ts`).
Re-clicking with **unchanged** hours reuses the same key → Xero dedupes, no double-pay.
**Corrected** hours change the hash → a fresh key → the re-export goes through. Covered by
`tests/xero-idempotency.test.ts`.

## Notes / limits
- Timesheets are pushed at status `APPROVED`. If Xero rejects one, the per-employee
  `validationErrors` surface in the result/chip; there is no in-app void path — fix in Xero.
- `approveWeekAndExportAction` commits the week's approvals before the push; if the push
  fails the approvals still stand (re-export when fixed).
- Pushing employee **records** to Xero (personal/tax/bank/super) is a separate, larger
  effort — see `ONBOARDING-XERO-PLAN.md`. This feature is hours only.
