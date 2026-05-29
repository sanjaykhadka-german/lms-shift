// AUDIT.md #8 — pure auto-scheduler generator.
//
// Greedy v1: walk shifts in start-time order; for each shift, pick the
// lowest-cost candidate who satisfies every constraint. No DB calls,
// no clock, no I/O — the caller materialises inputs and persists the
// proposal. Trivially testable, deterministic for a given input.
//
// Constraints respected (in evaluation order — cheapest first):
//   1. Shift's required skill ⊆ candidate's skill set
//   2. Approved leave overlap → skip
//   3. Availability jsonb declares the day + window → skip if mismatch
//   4. Running weekly-hours total ≤ maxWeeklyHoursMs → skip
//   5. Min rest from any existing or already-proposed shift end
//      to this shift's start → skip if shorter than minRestMs
//   6. Daily wage budget (optional) — adding this pick must not push
//      the shift's (location, start-day) running wage past the cap.
//      The whole shift cost is attributed to its start calendar day.
//
// Ties: lowest hourly rate; nulls treated as Infinity so rate-less
// employees lose to rate-set ones (predictable behaviour and matches
// the report's "excluded — no rate set" convention). Final tie-break
// is fullName ascending so the output is deterministic. The budget
// check (6) runs AFTER the rate sort: we walk the acceptable list
// cheapest-first and take the first candidate that still fits the
// day's remaining budget — so the guardrail prefers the cheapest
// in-budget option rather than rejecting the shift outright while a
// affordable candidate exists.

import { checkAvailability } from "./availability-check";

export interface AutoSchedulerShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Null = no skill required (any candidate is acceptable). */
  requiredSkillId: string | null;
  locationId: string;
  role: string;
}

export interface AutoSchedulerCandidate {
  appUserId: string;
  fullName: string;
  /** Null = no rate set; deprioritised in the tie-break. */
  hourlyRate: number | null;
  /** Existing sc_employees.availability jsonb shape. */
  availability: Record<string, string> | null;
  /** Set of skill UUIDs the employee carries. */
  skills: Set<string>;
}

export interface ApprovedLeaveWindow {
  /** YYYY-MM-DD inclusive. */
  startDate: string;
  endDate: string;
}

export interface ExistingAssignment {
  userId: string;
  startsAt: Date;
  endsAt: Date;
  /** Location of the existing shift — used to seed the per-(location,
   *  day) running wage so the budget guardrail accounts for shifts that
   *  were already on the roster before auto-fill ran. */
  locationId: string;
}

export interface AutoSchedulerOptions {
  /** Default 10h — matches the AU general-rule minimum rest. */
  minRestMs?: number;
  /** Default 40h — sensible week cap; tenants can override later. */
  maxWeeklyHoursMs?: number;
  /** Optional per-(location, local-start-day) wage budget in AUD.
   *  Key format: `${locationId}|${YYYY-MM-DD}`. Only locations with a
   *  budget configured appear in the map; a shift whose every affordable
   *  candidate would breach its day's budget is left unfilled with a
   *  budget-specific rejection reason. Omit (or empty map) to disable. */
  dayBudgets?: Map<string, number>;
}

export interface ProposedAssignment {
  shiftId: string;
  userId: string;
  /** Human-readable why-this-pick line for the review UI. */
  reasoning: string;
}

export interface UnfilledShift {
  shiftId: string;
  /** Why no candidate matched; one string per rejected candidate. */
  rejections: string[];
}

export interface AutoSchedulerResult {
  proposal: ProposedAssignment[];
  unfilled: UnfilledShift[];
}

const TEN_HOURS_MS = 10 * 60 * 60 * 1000;
const FORTY_HOURS_MS = 40 * 60 * 60 * 1000;

export function generateAssignmentPlan(
  shifts: AutoSchedulerShift[],
  candidates: AutoSchedulerCandidate[],
  existingAssignments: ExistingAssignment[],
  approvedLeave: Map<string, ApprovedLeaveWindow[]>,
  options: AutoSchedulerOptions = {},
): AutoSchedulerResult {
  const minRest = options.minRestMs ?? TEN_HOURS_MS;
  const maxWeekly = options.maxWeeklyHoursMs ?? FORTY_HOURS_MS;
  const dayBudgets = options.dayBudgets ?? new Map<string, number>();

  // Rate lookup so existing-assignment wage can be attributed when
  // seeding the per-day running cost below. Rate-less employees
  // contribute $0 (unknown cost), matching the labour-forecast
  // "what we know" convention.
  const rateByUser = new Map<string, number | null>();
  for (const c of candidates) rateByUser.set(c.appUserId, c.hourlyRate);

  // Running per-(location, start-day) wage, keyed `${locationId}|${iso}`.
  // Only meaningful for keys present in dayBudgets, but we track all so
  // the seeding loop stays branch-free.
  const dayCost = new Map<string, number>();
  const budgetKeyFor = (locationId: string, startsAt: Date) =>
    `${locationId}|${localDateIso(startsAt)}`;

  // Sort shifts chronologically for a stable greedy walk. Ties on
  // start time broken by shift id so re-runs return identical
  // proposals.
  const sortedShifts = [...shifts].sort((a, b) => {
    const t = a.startsAt.getTime() - b.startsAt.getTime();
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });

  // Running state, mutated as we assign:
  //   workMs[userId]    = total assigned ms this week (existing + proposed)
  //   shiftEnds[userId] = array of (start, end) windows used for min-rest
  const workMs = new Map<string, number>();
  const shiftEnds = new Map<string, Array<{ startsAt: Date; endsAt: Date }>>();
  for (const e of existingAssignments) {
    const ms = Math.max(0, e.endsAt.getTime() - e.startsAt.getTime());
    workMs.set(e.userId, (workMs.get(e.userId) ?? 0) + ms);
    const list = shiftEnds.get(e.userId) ?? [];
    list.push({ startsAt: e.startsAt, endsAt: e.endsAt });
    shiftEnds.set(e.userId, list);
    // Pre-load the day's wage so the budget guardrail counts shifts
    // already on the roster, not just the ones it proposes this run.
    const key = budgetKeyFor(e.locationId, e.startsAt);
    const cost = (ms / 3_600_000) * (rateByUser.get(e.userId) ?? 0);
    dayCost.set(key, (dayCost.get(key) ?? 0) + cost);
  }

  const proposal: ProposedAssignment[] = [];
  const unfilled: UnfilledShift[] = [];

  for (const shift of sortedShifts) {
    const shiftMs = shift.endsAt.getTime() - shift.startsAt.getTime();
    const rejections: string[] = [];
    const acceptable: Array<{
      candidate: AutoSchedulerCandidate;
      reasonBits: string[];
    }> = [];

    for (const c of candidates) {
      // 1. Required skill
      if (
        shift.requiredSkillId &&
        !c.skills.has(shift.requiredSkillId)
      ) {
        rejections.push(`${c.fullName}: missing required skill`);
        continue;
      }

      // 2. Approved leave overlap
      const leave = approvedLeave.get(c.appUserId);
      if (leave && overlapsAnyLeave(shift, leave)) {
        rejections.push(`${c.fullName}: on approved leave`);
        continue;
      }

      // 3. Availability declared for the day
      const verdict = checkAvailability(
        c.availability,
        shift.startsAt,
        shift.endsAt,
      );
      if (verdict.kind === "mismatch") {
        rejections.push(`${c.fullName}: ${verdict.reason}`);
        continue;
      }
      // "unknown" = no declared availability → don't penalise (matches
      // how the existing assign UI surfaces it). Falls through.

      // 4. Max weekly hours
      const current = workMs.get(c.appUserId) ?? 0;
      if (current + shiftMs > maxWeekly) {
        rejections.push(
          `${c.fullName}: would exceed ${fmtHours(maxWeekly)}/week cap`,
        );
        continue;
      }

      // 5. Min rest from any existing or proposed window
      const otherWindows = shiftEnds.get(c.appUserId) ?? [];
      const restViolation = findRestViolation(shift, otherWindows, minRest);
      if (restViolation) {
        rejections.push(
          `${c.fullName}: ${fmtHours(minRest)} rest violated (${restViolation})`,
        );
        continue;
      }

      const reasonBits: string[] = [];
      if (verdict.kind === "match") reasonBits.push("availability ok");
      else reasonBits.push("no availability declared");
      if (c.hourlyRate != null) {
        reasonBits.push(`$${c.hourlyRate.toFixed(2)}/h`);
      }
      acceptable.push({ candidate: c, reasonBits });
    }

    if (acceptable.length === 0) {
      unfilled.push({ shiftId: shift.id, rejections });
      continue;
    }

    // Lowest rate wins; null rates lose; final tie-break on name.
    acceptable.sort((a, b) => {
      const aRate = a.candidate.hourlyRate ?? Infinity;
      const bRate = b.candidate.hourlyRate ?? Infinity;
      if (aRate !== bRate) return aRate - bRate;
      return a.candidate.fullName.localeCompare(b.candidate.fullName);
    });

    // Constraint 6 — daily wage budget. Walk cheapest-first and take
    // the first candidate that keeps the day's (location) wage within
    // the cap. No budget for this key → the cheapest acceptable wins
    // immediately (legacy behaviour). Candidates skipped purely for
    // budget add a rejection line so the unfilled view explains it.
    const budgetKey = budgetKeyFor(shift.locationId, shift.startsAt);
    const budget = dayBudgets.get(budgetKey);
    const spentToday = dayCost.get(budgetKey) ?? 0;
    const shiftHours = shiftMs / 3_600_000;

    let pick: (typeof acceptable)[number] | null = null;
    let pickCost = 0;
    let pickProjectedTotal = spentToday;
    for (const cand of acceptable) {
      const candCost = (cand.candidate.hourlyRate ?? 0) * shiftHours;
      if (budget == null || spentToday + candCost <= budget) {
        pick = cand;
        pickCost = candCost;
        pickProjectedTotal = spentToday + candCost;
        break;
      }
      rejections.push(
        `${cand.candidate.fullName}: would breach $${budget.toFixed(0)}/day ` +
          `wage budget (day total $${(spentToday + candCost).toFixed(0)})`,
      );
    }

    if (!pick) {
      // Everyone acceptable on skills/availability/rest blew the budget.
      unfilled.push({ shiftId: shift.id, rejections });
      continue;
    }

    const reasoning =
      budget == null
        ? pick.reasonBits.join(", ")
        : `${pick.reasonBits.join(", ")}, day spend $${pickProjectedTotal.toFixed(0)}/$${budget.toFixed(0)}`;

    proposal.push({
      shiftId: shift.id,
      userId: pick.candidate.appUserId,
      reasoning,
    });

    // Update running state so subsequent shifts respect the new
    // assignment for max-hours + min-rest + budget computations.
    workMs.set(
      pick.candidate.appUserId,
      (workMs.get(pick.candidate.appUserId) ?? 0) + shiftMs,
    );
    const list = shiftEnds.get(pick.candidate.appUserId) ?? [];
    list.push({ startsAt: shift.startsAt, endsAt: shift.endsAt });
    shiftEnds.set(pick.candidate.appUserId, list);
    if (budget != null) dayCost.set(budgetKey, spentToday + pickCost);
  }

  return { proposal, unfilled };
}

function overlapsAnyLeave(
  shift: { startsAt: Date; endsAt: Date },
  leave: ApprovedLeaveWindow[],
): boolean {
  // Leave dates are calendar-day ranges (no time). Treat the shift as
  // overlapping if its calendar day falls in [startDate, endDate]. We
  // compare ISO YYYY-MM-DD strings — lexical sort matches chronological
  // sort, so direct comparison is safe.
  const shiftDate = localDateIso(shift.startsAt);
  const shiftEndDate = localDateIso(shift.endsAt);
  for (const w of leave) {
    if (w.startDate <= shiftEndDate && w.endDate >= shiftDate) return true;
  }
  return false;
}

function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function findRestViolation(
  shift: { startsAt: Date; endsAt: Date },
  windows: Array<{ startsAt: Date; endsAt: Date }>,
  minRestMs: number,
): string | null {
  for (const w of windows) {
    // Existing window ends before shift starts: gap = shift.start − w.end
    if (w.endsAt.getTime() <= shift.startsAt.getTime()) {
      const gap = shift.startsAt.getTime() - w.endsAt.getTime();
      if (gap < minRestMs) {
        return `only ${fmtHours(gap)} since prior shift`;
      }
    }
    // Existing window starts after shift ends: gap = w.start − shift.end
    else if (w.startsAt.getTime() >= shift.endsAt.getTime()) {
      const gap = w.startsAt.getTime() - shift.endsAt.getTime();
      if (gap < minRestMs) {
        return `only ${fmtHours(gap)} before next shift`;
      }
    } else {
      // Overlap — the shift literally collides with another, not a
      // rest issue. The unique sc_shift_user_uq index would reject
      // this anyway when the proposal is committed, but flagging it
      // here keeps the rejection reason readable.
      return "overlaps another shift";
    }
  }
  return null;
}

function fmtHours(ms: number): string {
  const h = ms / 3_600_000;
  if (h >= 10) return `${Math.round(h)}h`;
  return `${h.toFixed(1)}h`;
}
