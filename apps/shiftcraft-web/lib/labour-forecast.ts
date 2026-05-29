import "server-only";
import { and, between, eq, ne } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
} from "@tracey/db";

// ─── Pure projection math ────────────────────────────────────────────────
//
// A shift's projected cost is just (hours × rate). Hours come from the
// shift window; rate comes from the accepted employee's hourly_rate.
// Anything missing (no acceptance yet, or accepted but no rate set) is
// surfaced as a caveat counter rather than guessed at — admins want
// "what we know" not "what we hope".

export function hoursBetween(startsAt: Date, endsAt: Date): number {
  return Math.max(0, (endsAt.getTime() - startsAt.getTime()) / 3_600_000);
}

export function projectShiftCost(
  startsAt: Date,
  endsAt: Date,
  rate: number | null,
): number {
  if (rate == null) return 0;
  return hoursBetween(startsAt, endsAt) * rate;
}

export interface LabourForecast {
  totalCost: number;
  totalHours: number;
  shiftCount: number;
  /** Published shifts in range with no accepted assignment yet. */
  uncoveredCount: number;
  /** Published shifts with an accepted assignment but the employee has no hourly rate set. */
  missingRateCount: number;
  byLocation: Array<{
    locationId: string | null;
    locationName: string | null;
    cost: number;
    hours: number;
    /** dailyWageBudget × 7 for this location. Null when the location
     *  has no budget set (or the "Unassigned" bucket). */
    weeklyBudget: number | null;
  }>;
  /** Sum of every location's daily wage budget. Null when no location
   *  in the tenant has a budget configured (guardrail inactive). */
  dailyBudgetTotal: number | null;
  /** dailyBudgetTotal × 7. Null when dailyBudgetTotal is null. */
  weeklyBudgetTotal: number | null;
  /** Projected cost per day index 0..6 (Mon..Sun, relative to
   *  weekStart). Lets the UI flag days that run over the daily budget. */
  costByDay: number[];
}

// ─── DB helper ───────────────────────────────────────────────────────────
//
// Projects labour cost for one week's worth of published (non-cancelled)
// shifts, joining each shift to its accepted assignment → employee row
// to recover the hourly rate. Cancelled shifts are excluded because
// they're definitionally not happening.

export async function forecastWeek(
  tenantId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<LabourForecast> {
  const [rows, budgetRows] = await forTenant(tenantId).run((tx) =>
    Promise.all([
      tx
        .select({
          shiftId: scShifts.id,
          locationId: scShifts.locationId,
          locationName: scLocations.name,
          startsAt: scShifts.startsAt,
          endsAt: scShifts.endsAt,
          acceptedUserId: scShiftAssignments.userId,
          hourlyRate: scEmployees.hourlyRate,
        })
        .from(scShifts)
        .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
        .leftJoin(
          scShiftAssignments,
          and(
            eq(scShiftAssignments.shiftId, scShifts.id),
            eq(scShiftAssignments.status, "accepted"),
          ),
        )
        .leftJoin(
          scEmployees,
          and(
            eq(scEmployees.appUserId, scShiftAssignments.userId),
            eq(scEmployees.traceyTenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(scShifts.traceyTenantId, tenantId),
            between(scShifts.startsAt, weekStart, weekEnd),
            ne(scShifts.status, "cancelled"),
          ),
        ),
      // Every budgeted location in the tenant — independent of whether it
      // has shifts this week — so the daily budget total reflects the
      // whole business's labour capacity, not just rostered sites.
      tx
        .select({
          id: scLocations.id,
          dailyWageBudget: scLocations.dailyWageBudget,
        })
        .from(scLocations)
        .where(eq(scLocations.traceyTenantId, tenantId)),
    ]),
  );

  // Per-location daily budget map + tenant-wide daily total.
  const dailyBudgetByLocation = new Map<string, number>();
  let dailyBudgetTotal: number | null = null;
  for (const b of budgetRows) {
    if (b.dailyWageBudget == null) continue;
    const v = Number(b.dailyWageBudget);
    if (!Number.isFinite(v)) continue;
    dailyBudgetByLocation.set(b.id, v);
    dailyBudgetTotal = (dailyBudgetTotal ?? 0) + v;
  }

  // De-dup shifts that joined to multiple employees (shouldn't happen for
  // accepted shifts since uniqueness is on shift_id+user_id and we filter
  // status='accepted', but cheap to guard).
  const seen = new Set<string>();
  let totalCost = 0;
  let totalHours = 0;
  let uncoveredCount = 0;
  let missingRateCount = 0;
  const costByDay = Array.from({ length: 7 }, () => 0);
  const byLocation = new Map<
    string,
    { locationId: string | null; locationName: string | null; cost: number; hours: number }
  >();

  for (const r of rows) {
    if (seen.has(r.shiftId)) continue;
    seen.add(r.shiftId);

    const hours = hoursBetween(r.startsAt, r.endsAt);
    const rateNum = r.hourlyRate == null ? null : Number(r.hourlyRate);
    const cost = projectShiftCost(r.startsAt, r.endsAt, rateNum);

    totalHours += hours;
    totalCost += cost;
    if (r.acceptedUserId == null) uncoveredCount += 1;
    else if (rateNum == null) missingRateCount += 1;

    // Attribute the whole shift's cost to its start calendar day —
    // matches the auto-scheduler's budget bucketing.
    const dayIdx = Math.floor(
      (r.startsAt.getTime() - weekStart.getTime()) / 86_400_000,
    );
    if (dayIdx >= 0 && dayIdx <= 6) costByDay[dayIdx]! += cost;

    const key = r.locationId ?? "_none";
    const slot = byLocation.get(key) ?? {
      locationId: r.locationId,
      locationName: r.locationName,
      cost: 0,
      hours: 0,
    };
    slot.cost += cost;
    slot.hours += hours;
    byLocation.set(key, slot);
  }

  return {
    totalCost,
    totalHours,
    shiftCount: seen.size,
    uncoveredCount,
    missingRateCount,
    byLocation: Array.from(byLocation.values())
      .map((slot) => ({
        ...slot,
        weeklyBudget:
          slot.locationId != null && dailyBudgetByLocation.has(slot.locationId)
            ? dailyBudgetByLocation.get(slot.locationId)! * 7
            : null,
      }))
      .sort((a, b) => b.cost - a.cost),
    dailyBudgetTotal,
    weeklyBudgetTotal: dailyBudgetTotal == null ? null : dailyBudgetTotal * 7,
    costByDay,
  };
}

export function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(h < 10 ? 1 : 0)}h`;
}
