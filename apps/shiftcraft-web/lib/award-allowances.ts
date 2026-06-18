import "server-only";
import { and, eq } from "drizzle-orm";
import { forTenant, scAwardAllowances, scEmployeeAllowances } from "@tracey/db";
import type { AllowanceType } from "@tracey/award";

// Server-side readers for award allowances (Slice C).

export interface AllowanceRow {
  id: string;
  awardCode: string;
  key: string;
  label: string;
  type: AllowanceType;
  amount: number;
  taxable: boolean;
  effectiveFrom: string;
  source: string;
}

export async function listAllowances(
  tenantId: string,
  awardCode: string,
): Promise<AllowanceRow[]> {
  if (!awardCode) return [];
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scAwardAllowances)
      .where(
        and(
          eq(scAwardAllowances.traceyTenantId, tenantId),
          eq(scAwardAllowances.awardCode, awardCode),
        ),
      ),
  );
  return rows.map((r) => ({
    id: r.id,
    awardCode: r.awardCode,
    key: r.key,
    label: r.label,
    type: r.type as AllowanceType,
    amount: Number(r.amount),
    taxable: r.taxable,
    effectiveFrom: r.effectiveFrom,
    source: r.source,
  }));
}

// Map of employeeId -> set of assigned allowance ids.
export async function getEmployeeAllowanceMap(
  tenantId: string,
): Promise<Map<string, Set<string>>> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        employeeId: scEmployeeAllowances.employeeId,
        allowanceId: scEmployeeAllowances.allowanceId,
      })
      .from(scEmployeeAllowances)
      .where(eq(scEmployeeAllowances.traceyTenantId, tenantId)),
  );
  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = map.get(r.employeeId) ?? new Set<string>();
    set.add(r.allowanceId);
    map.set(r.employeeId, set);
  }
  return map;
}
