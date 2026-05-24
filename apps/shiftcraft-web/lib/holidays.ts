import "server-only";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { db, forTenant, scTenantConfig, type ScHolidayRegion } from "@tracey/db";

// AUDIT.md Phase 2 #3a — AU public holiday lookup.
//
// Downstream consumers (rate interpreter, schedule UI, leave overlap
// check) call `getHolidaysForTenant(tenantId, from, to)` once per view
// and use the pure `isPublicHoliday(date, holidays)` predicate to check
// many dates without re-hitting the DB.

export const HOLIDAY_REGIONS = [
  "national",
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;

export const HOLIDAY_REGION_LABELS: Record<ScHolidayRegion, string> = {
  national: "National only (no state observance)",
  NSW: "New South Wales (NSW + national)",
  VIC: "Victoria (VIC + national)",
  QLD: "Queensland (QLD + national)",
  WA: "Western Australia (WA + national)",
  SA: "South Australia (SA + national)",
  TAS: "Tasmania (TAS + national)",
  ACT: "Australian Capital Territory (ACT + national)",
  NT: "Northern Territory (NT + national)",
};

export interface HolidayRow {
  region: ScHolidayRegion;
  date: string; // ISO YYYY-MM-DD
  name: string;
  isNational: boolean;
}

// Reads the tenant's configured region from sc_tenant_config. Returns
// "national" when no config row exists yet (lazy-default — first save
// from the settings page creates the row).
export async function getTenantHolidayRegion(
  tenantId: string,
): Promise<ScHolidayRegion> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ region: scTenantConfig.holidayRegion })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  return (row?.region as ScHolidayRegion | undefined) ?? "national";
}

// Returns rows that the tenant observes (national + the tenant's state)
// in the [fromISO, toISO] inclusive range. Sorted by date asc.
export async function getHolidaysForTenant(
  tenantId: string,
  fromISO: string,
  toISO: string,
): Promise<HolidayRow[]> {
  const region = await getTenantHolidayRegion(tenantId);
  const regionsToFetch: ScHolidayRegion[] =
    region === "national" ? ["national"] : ["national", region];

  // au_public_holidays lives in `public` and is not a Drizzle-tracked
  // table on this branch — it's operator-managed reference data. Query
  // via raw SQL through the same pool. `inArray` over a parameterised
  // text-array would also work; explicit values keep the query plan tight.
  const rows = (await db.execute(drizzleSql`
    SELECT region, observed_on::text AS observed_on, name, is_national
    FROM public.au_public_holidays
    WHERE region = ANY(${regionsToFetch as unknown as string[]})
      AND observed_on BETWEEN ${fromISO}::date AND ${toISO}::date
    ORDER BY observed_on ASC
  `)) as unknown as Array<{
    region: ScHolidayRegion;
    observed_on: string;
    name: string;
    is_national: boolean;
  }>;

  return rows.map((r) => ({
    region: r.region,
    date: r.observed_on,
    name: r.name,
    isNational: r.is_national,
  }));
}

// Pure predicate. Callers should fetch once per visible range and call
// this for each date they need to check (no DB round-trip).
export function isPublicHoliday(
  dateISO: string,
  holidays: ReadonlyArray<HolidayRow>,
): boolean {
  for (const h of holidays) {
    if (h.date === dateISO) return true;
  }
  return false;
}
