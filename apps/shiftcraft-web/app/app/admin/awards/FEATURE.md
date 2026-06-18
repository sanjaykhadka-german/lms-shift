# Fair Work / Modern Award integration (inbound)

Pulls Modern Award **rules** into ShiftCraft so timesheets interpret hours
correctly and managers can see classification minimums and allowances. The
counterpart to the Xero push (which sends the interpreted hours out).

> **Boundary:** ShiftCraft never computes tax/super/payslips. Pulling award
> *rates* from Fair Work is fine — FWC is the authoritative source. Xero
> finalises pay.

> **Rates vs rules:** the award *rules* (hours thresholds, penalty/OT
> multipliers) are seeded as presets and rarely change. The *dollar rates*
> (classification minimums, allowance amounts) are legally binding, change every
> **1 July**, and come from the Fair Work pull (Slice D) — never hand-typed.

## Pieces

| Concern | Where |
|---|---|
| Pure rule engine (classify week, penalties) | `@tracey/award` (`packages/award/src/index.ts`) |
| Award presets (code → rule structure) | `@tracey/award` (`packages/award/src/presets.ts`, `src/data/*`) |
| Tenant award profile (overrides jsonb) | `sc_tenant_config.award_profile` + `lib/award-profile.ts` |
| Cost engine + resolver | `lib/timesheet-classifier.ts` |

## Slice A — preset library + industry selector (shipped)
- `AWARD_PRESETS` in `@tracey/award`; first award **MA000059** (Meat Industry
  Award 2020). Adding an award = a data file under `packages/award/src/data/`.
- `sc_tenant_config` gains `award_code` + `award_effective_from`
  (per-tenant migration `0059`, public template `0046`).
- Workspace settings → Award profile: an **Industry / Award** picker that stamps
  the preset's rule structure into the editable `award_profile` fields
  ("Apply / re-apply preset"). Audited as `shiftcraft.tenant.award_profile_changed`.
- **The preset seeds rules only.** Its multipliers carry `VERIFY` flags; confirm
  against the current award + Fair Work Pay Guide. Real rates arrive via Slice D.

## Slice B — classifications + minimum-rate floor (shipped)
- Per-tenant `sc_award_classifications` (per-tenant migration `0060`, public
  template `0047`): `(award_code, level_code)` → `base_hourly_rate` +
  `casual_loading` + `effective_from` + `source` (`manual`|`fwc`). History kept;
  the current row is the latest `effective_from <= today`.
- `sc_employees.award_level_code` links an employee to a level (plain text, so a
  Fair Work re-pull that recreates rows never breaks the link).
- Pure `checkRateFloor` in `@tracey/award`: casuals held to base × (1 + casual
  loading). Reusable — the Xero/approval workstream can call it without ShiftCraft
  touching `xero-actions.ts`.
- Admin page **`/app/admin/awards`** (owner-only): manage classifications, assign
  each team member a level, and toggle floor enforcement
  (`sc_tenant_config.award_floor_block`: warn vs hard-block). Under-minimum shows
  an inline badge per employee.
- Test: `tests/award-floor.test.ts`.
- Follow-on: surface the same `checkRateFloor` badge on the timesheets cost row
  and the employee edit page (thin wiring using the exposed helper).

## Slice C — allowances (shipped)
- Per-tenant `sc_award_allowances` ((award, key) → `type` (flat | per_hour |
  per_shift | per_day) + `amount` + `taxable` + `effective_from` + `source`) and
  `sc_employee_allowances` (employee ↔ allowance). Per-tenant migration `0061`
  (FKs re-attached to the local tables), public template `0048`.
- Pure `computeAllowances` in `@tracey/award`: per_hour × worked hours,
  per_shift × shifts, per_day × distinct days, flat once/week. Emits the
  `allowance` payroll-category lines + total. Test: `tests/award-allowances.test.ts`.
- `/app/admin/awards`: manage allowances (add/update/delete) and tick which
  allowances each team member receives.
- **Boundary:** stops at the `allowance` category output. Flat/$ allowances are
  dollars, not hours — reconciling that with the hours-based Xero `numberOfUnits`
  is the Xero workstream's job (not wired here). Shift/role-level attach is a
  documented follow-on (employee-level for v1).

<!-- Slice D (FWC MAPD fetcher) extends this file as it ships. -->
