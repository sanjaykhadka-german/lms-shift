import "server-only";
import { eq } from "drizzle-orm";
import { forTenant, scTenantConfig } from "@tracey/db";
import {
  _parseAwardProfile,
  type AwardProfileOverrides,
} from "./timesheet-classifier";

// Server-side reader for sc_tenant_config.award_profile (Phase 2 #3b.5).
// Kept in its own module so the pure-function classifier helpers stay
// importable from vitest specs without pulling @tracey/db/client.ts
// (which throws when DATABASE_URL isn't set at module load).

// Reads the tenant's stored award profile. Empty when no row exists or
// the column is null — the caller treats absent fields as defaults.
export async function getTenantAwardProfile(
  tenantId: string,
): Promise<AwardProfileOverrides> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ awardProfile: scTenantConfig.awardProfile })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  return _parseAwardProfile(row?.awardProfile);
}

// Reads the named award + its effective date (Slice A). Kept separate from
// getTenantAwardProfile so that helper's signature — relied on elsewhere —
// stays unchanged. Returns nulls when no award has been selected.
export interface TenantAwardMeta {
  awardCode: string | null;
  awardEffectiveFrom: string | null;
  /** Under-minimum floor enforcement: false = warn only, true = hard block. */
  awardFloorBlock: boolean;
}

export async function getTenantAwardMeta(
  tenantId: string,
): Promise<TenantAwardMeta> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        awardCode: scTenantConfig.awardCode,
        awardEffectiveFrom: scTenantConfig.awardEffectiveFrom,
        awardFloorBlock: scTenantConfig.awardFloorBlock,
      })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  return {
    awardCode: row?.awardCode ?? null,
    awardEffectiveFrom: row?.awardEffectiveFrom ?? null,
    awardFloorBlock: row?.awardFloorBlock ?? false,
  };
}
