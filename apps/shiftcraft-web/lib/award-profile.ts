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
