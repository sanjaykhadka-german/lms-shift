import "server-only";
import { and, eq } from "drizzle-orm";
import { forTenant, scAwardClassifications } from "@tracey/db";

// Server-side readers for award classifications (Slice B). Kept out of the
// pure @tracey/award package (which stays DB-free).

export interface ClassificationRow {
  id: string;
  awardCode: string;
  levelCode: string;
  label: string;
  baseHourlyRate: number;
  casualLoading: number | null;
  effectiveFrom: string;
  source: string;
}

function toRow(r: typeof scAwardClassifications.$inferSelect): ClassificationRow {
  return {
    id: r.id,
    awardCode: r.awardCode,
    levelCode: r.levelCode,
    label: r.label,
    baseHourlyRate: Number(r.baseHourlyRate),
    casualLoading: r.casualLoading == null ? null : Number(r.casualLoading),
    effectiveFrom: r.effectiveFrom,
    source: r.source,
  };
}

// All classification rows for an award (every effective_from kept).
export async function listClassifications(
  tenantId: string,
  awardCode: string,
): Promise<ClassificationRow[]> {
  if (!awardCode) return [];
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select()
      .from(scAwardClassifications)
      .where(
        and(
          eq(scAwardClassifications.traceyTenantId, tenantId),
          eq(scAwardClassifications.awardCode, awardCode),
        ),
      ),
  );
  return rows.map(toRow);
}

// Reduce a row list to the currently-applicable row per level (latest
// effective_from that is on/before `asOf`, default today). Pure given rows.
export function resolveCurrent(
  rows: ClassificationRow[],
  asOf: string,
): Map<string, ClassificationRow> {
  const byLevel = new Map<string, ClassificationRow>();
  for (const r of rows) {
    if (r.effectiveFrom > asOf) continue;
    const existing = byLevel.get(r.levelCode);
    if (!existing || r.effectiveFrom > existing.effectiveFrom) {
      byLevel.set(r.levelCode, r);
    }
  }
  return byLevel;
}
