import "server-only";
import { asc } from "drizzle-orm";
import { forTenant, scLocations, type ScLocation } from "@tracey/db";

/**
 * Lists a tenant's locations. Runs through forTenant() so the app.tenant_id
 * GUC is set and RLS scopes the read to this tenant (and would fail-closed to
 * zero rows if the GUC were ever missing).
 */
export async function listLocations(tenantId: string): Promise<ScLocation[]> {
  return forTenant(tenantId).run((tx) =>
    tx.select().from(scLocations).orderBy(asc(scLocations.name)),
  );
}

// Common IANA timezones offered in the create form. Free-text is still allowed
// server-side; this is just a convenience list.
export const COMMON_TIMEZONES = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Adelaide",
  "Australia/Perth",
  "Pacific/Auckland",
  "UTC",
] as const;
