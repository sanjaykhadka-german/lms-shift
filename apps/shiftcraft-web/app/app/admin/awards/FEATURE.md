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

<!-- Slices B (classifications + floor), C (allowances), D (FWC MAPD fetcher)
     extend this file as they ship. -->
