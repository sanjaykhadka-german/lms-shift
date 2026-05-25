import "server-only";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import {
  forTenant,
  scDailySales,
  scLocations,
  type ScDailySale,
} from "@tracey/db";

// ─── Daily-sales lookups (AUDIT.md #9) ──────────────────────────────
//
// Manual revenue entries per (location, business_date). The schedule /
// timesheet code expresses windows as tz-aware timestamps; daily sales
// uses ISO date strings (no time-of-day) since "Tuesday's takings" is
// always a calendar day regardless of timezone.

export interface DailySaleRow {
  id: string;
  locationId: string;
  businessDate: string;
  grossSales: string; // numeric column comes back as string from postgres-js
  notes: string | null;
}

export interface SalesByDate {
  /** ISO YYYY-MM-DD */
  date: string;
  total: number;
  byLocation: Map<string, number>;
}

/**
 * List sales rows for a tenant in a [start, end) window. `end` is the
 * exclusive upper bound — pass `addDays(start, 7)` for one week.
 */
export async function listDailySales(
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<DailySaleRow[]> {
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scDailySales.id,
        locationId: scDailySales.locationId,
        businessDate: scDailySales.businessDate,
        grossSales: scDailySales.grossSales,
        notes: scDailySales.notes,
      })
      .from(scDailySales)
      .where(
        and(
          eq(scDailySales.traceyTenantId, tenantId),
          gte(scDailySales.businessDate, startDate),
          lt(scDailySales.businessDate, endDate),
        ),
      )
      .orderBy(asc(scDailySales.businessDate), asc(scDailySales.locationId)),
  );
  return rows;
}

/**
 * Aggregate sales for a date range into a map keyed by ISO date. Each
 * entry carries the cross-location total plus a per-location breakdown
 * so callers that want a per-site view don't need a second pass.
 */
export function aggregateSalesByDate(
  rows: DailySaleRow[],
): Map<string, SalesByDate> {
  const out = new Map<string, SalesByDate>();
  for (const r of rows) {
    const value = Number(r.grossSales);
    if (!Number.isFinite(value)) continue;
    const existing = out.get(r.businessDate) ?? {
      date: r.businessDate,
      total: 0,
      byLocation: new Map<string, number>(),
    };
    existing.total += value;
    existing.byLocation.set(
      r.locationId,
      (existing.byLocation.get(r.locationId) ?? 0) + value,
    );
    out.set(r.businessDate, existing);
  }
  return out;
}

/**
 * Tenant currency total across a date window. Convenience for the
 * wages-vs-sales card where the week-level number is what matters.
 */
export function sumGrossSales(rows: DailySaleRow[]): number {
  let total = 0;
  for (const r of rows) {
    const value = Number(r.grossSales);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

export async function listLocationsLite(
  tenantId: string,
): Promise<Array<{ id: string; name: string; color: string | null }>> {
  return forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scLocations.id,
        name: scLocations.name,
        color: scLocations.color,
      })
      .from(scLocations)
      .where(eq(scLocations.traceyTenantId, tenantId))
      .orderBy(asc(scLocations.name)),
  );
}

export type DailySaleType = ScDailySale;
