import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  forTenant,
  scShiftAssignments,
  scShifts,
  scTenantConfig,
} from "@tracey/db";

// Clock-in policy for web punches (the kiosk path is governed separately at
// the paired device). Mirrors the columns on sc_tenant_config; all default to
// the prior behaviour so a tenant with no config row behaves as before.
export interface ClockPolicy {
  allowWebClock: boolean;
  allowUnscheduledClockIn: boolean;
  requireGeofence: boolean;
  requireSelfie: boolean;
  requireScheduledShift: boolean;
}

export const DEFAULT_CLOCK_POLICY: ClockPolicy = {
  allowWebClock: true,
  allowUnscheduledClockIn: false,
  requireGeofence: false,
  requireSelfie: false,
  requireScheduledShift: false,
};

export async function getClockPolicy(tenantId: string): Promise<ClockPolicy> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        allowWebClock: scTenantConfig.allowWebClock,
        allowUnscheduledClockIn: scTenantConfig.allowUnscheduledClockIn,
        requireGeofence: scTenantConfig.requireGeofence,
        requireSelfie: scTenantConfig.requireSelfie,
        requireScheduledShift: scTenantConfig.requireScheduledShift,
      })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  if (!row) return { ...DEFAULT_CLOCK_POLICY };
  return {
    allowWebClock: row.allowWebClock,
    allowUnscheduledClockIn: row.allowUnscheduledClockIn,
    requireGeofence: row.requireGeofence,
    requireSelfie: row.requireSelfie,
    requireScheduledShift: row.requireScheduledShift,
  };
}

// Early-clock-in grace: a roster slot counts as "current" from 60 minutes
// before it starts until it ends. Keeps a punch a few minutes early from
// being rejected as unscheduled.
const EARLY_GRACE_MS = 60 * 60 * 1000;

// True when `userId` has an accepted/offered assignment whose shift covers
// `at` (within the early-clock-in grace). Used to enforce
// requireScheduledShift and to flag unscheduled punches for admin review.
export async function hasScheduledShiftNow(
  tenantId: string,
  userId: string,
  at: Date,
): Promise<boolean> {
  const graceWindowEnd = new Date(at.getTime() + EARLY_GRACE_MS);
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scShifts.id })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .where(
        and(
          eq(scShiftAssignments.userId, userId),
          inArray(scShiftAssignments.status, ["accepted", "offered"]),
          eq(scShifts.traceyTenantId, tenantId),
          lte(scShifts.startsAt, graceWindowEnd),
          gte(scShifts.endsAt, at),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}
