"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scClockEvents,
  scShiftAssignments,
  scShifts,
  scTimesheetApprovals,
  type ScClockEventType,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { fmtIsoDate, startOfWeek, validateTransition } from "~/lib/clock";
import { logAuditEvent } from "~/lib/audit";

// AUDIT.md #4 — lock clock-event mutations on weeks whose timesheet
// has been approved. Returns null when the week is unlocked, otherwise
// a human-readable refusal reason. Caller is responsible for emitting
// the warning + early return; we deliberately don't throw so the form
// action's Promise<void> contract stays intact.
//
// Pure check — no audit event, no side effects.
async function assertWeekUnlocked(
  tenantId: string,
  appUserId: string,
  occurredAt: Date,
): Promise<string | null> {
  const weekStartIso = fmtIsoDate(startOfWeek(occurredAt));
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ status: scTimesheetApprovals.status })
      .from(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, tenantId),
          eq(scTimesheetApprovals.employeeUserId, appUserId),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      )
      .limit(1),
  );
  if (row?.status === "approved") {
    return "Timesheet for this week is approved — reopen it first to edit clock events.";
  }
  return null;
}

// Three admin-only actions for in-app correction of clock events. All
// preserve audit semantics: edits void the original row + insert a new
// one with source='admin_edit'; voids set voided_at without deleting.
// Read paths in lib/clock.ts filter `voided_at IS NULL` so the
// aggregation behaves as if the row were gone.

const EVENT_TYPE_VALUES = ["in", "out", "break_start", "break_end"] as const;

const addSchema = z.object({
  appUserId: z.string().uuid(),
  eventType: z.enum(EVENT_TYPE_VALUES),
  occurredAt: z.string().min(1),
  locationId: z.string().uuid().optional().or(z.literal("")),
  reason: z
    .string()
    .trim()
    .min(1, "Tell future-you why you're adding this punch.")
    .max(200),
});

const editSchema = z.object({
  originalEventId: z.string().uuid(),
  occurredAt: z.string().min(1),
  locationId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(1).max(200),
});

const voidSchema = z.object({
  eventId: z.string().uuid(),
  reason: z.string().trim().min(1).max(200),
});

async function gate(): Promise<
  | { ok: true; tenantId: string; meId: string }
  | { ok: false; message: string }
> {
  const m = await currentMembership();
  if (!m) return { ok: false, message: "Not signed in." };
  if (!isAtLeastManager(m.role)) {
    return {
      ok: false,
      message: "Only managers can edit clock events.",
    };
  }
  const me = await currentUser();
  if (!me) return { ok: false, message: "Not signed in." };
  return { ok: true, tenantId: m.tenant.id, meId: me.id };
}

function emptyToNull(s: string | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Validates a new event in the context of the user's existing stream by
// walking the active events around its occurredAt and asking
// validateTransition() if it fits. Returns null on OK or an error string.
async function validateInsertion(
  tenantId: string,
  appUserId: string,
  eventType: ScClockEventType,
  occurredAt: Date,
  excludeEventId?: string,
): Promise<string | null> {
  const stream = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scClockEvents.id,
        eventType: scClockEvents.eventType,
        occurredAt: scClockEvents.occurredAt,
      })
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, appUserId),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(asc(scClockEvents.occurredAt)),
  );
  // Find the latest active event strictly before occurredAt — excluding
  // the to-be-voided row when this is part of an edit. That's the
  // "prev" state validateTransition() needs.
  let prev: ScClockEventType | undefined = undefined;
  for (const e of stream) {
    if (excludeEventId && e.id === excludeEventId) continue;
    if (e.occurredAt.getTime() >= occurredAt.getTime()) break;
    prev = e.eventType as ScClockEventType;
  }
  return validateTransition(prev, eventType);
}

export async function addClockEventAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[addClockEventAction] refused:", g.message);
    return;
  }
  const parsed = addSchema.safeParse({
    appUserId: formData.get("appUserId"),
    eventType: formData.get("eventType"),
    occurredAt: formData.get("occurredAt"),
    locationId: formData.get("locationId") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[addClockEventAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return;
  }

  const occurredAt = new Date(parsed.data.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    console.warn("[addClockEventAction] invalid occurredAt:", parsed.data.occurredAt);
    return;
  }

  const lockErr = await assertWeekUnlocked(
    g.tenantId,
    parsed.data.appUserId,
    occurredAt,
  );
  if (lockErr) {
    console.warn("[addClockEventAction] locked:", lockErr);
    return;
  }

  const stateErr = await validateInsertion(
    g.tenantId,
    parsed.data.appUserId,
    parsed.data.eventType,
    occurredAt,
  );
  if (stateErr) {
    console.warn("[addClockEventAction] state-machine reject:", stateErr);
    return;
  }

  let newEventId = "";
  await forTenant(g.tenantId).run(async (tx) => {
    const [inserted] = await tx
      .insert(scClockEvents)
      .values({
        traceyTenantId: g.tenantId,
        appUserId: parsed.data.appUserId,
        eventType: parsed.data.eventType,
        occurredAt,
        locationId: emptyToNull(parsed.data.locationId),
        source: "admin_edit",
        notes: parsed.data.reason,
      })
      .returning({ id: scClockEvents.id });
    newEventId = inserted!.id;
  });

  await logAuditEvent({
    action: "shiftcraft.clock.added",
    targetKind: "sc_clock_event",
    targetId: newEventId,
    details: {
      appUserId: parsed.data.appUserId,
      eventType: parsed.data.eventType,
      occurredAt: occurredAt.toISOString(),
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/app/timesheets");
}

// Streamlined "add a whole timesheet entry" for onboarding staff who never
// clocked in: an admin enters a date, start + finish, and an optional unpaid
// break, and we emit the matching in / break_start / break_end / out punches
// (all source='admin_edit') in chronological order, validating each against
// the employee's stream and the approved-week lock. Sequential inserts so
// each validateInsertion sees the previous punch we just added.
const fullEntrySchema = z.object({
  appUserId: z.string().uuid(),
  date: z.string().min(1), // YYYY-MM-DD
  clockIn: z.string().min(1), // HH:MM
  clockOut: z.string().min(1), // HH:MM
  breakStart: z.string().optional().or(z.literal("")),
  breakEnd: z.string().optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(1, "Add a note.").max(200),
});

export async function addTimesheetEntryAction(
  formData: FormData,
): Promise<void> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[addTimesheetEntryAction] refused:", g.message);
    return;
  }
  const parsed = fullEntrySchema.safeParse({
    appUserId: formData.get("appUserId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut"),
    breakStart: formData.get("breakStart") ?? "",
    breakEnd: formData.get("breakEnd") ?? "",
    locationId: formData.get("locationId") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[addTimesheetEntryAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return;
  }

  const combine = (time: string): Date => new Date(`${parsed.data.date}T${time}`);
  const inAt = combine(parsed.data.clockIn);
  const outAt = combine(parsed.data.clockOut);
  if (Number.isNaN(inAt.getTime()) || Number.isNaN(outAt.getTime())) {
    console.warn("[addTimesheetEntryAction] bad date/time");
    return;
  }
  if (outAt.getTime() <= inAt.getTime()) {
    console.warn("[addTimesheetEntryAction] finish must be after start");
    return;
  }

  // Build the punch sequence in chronological order.
  const punches: Array<{ eventType: ScClockEventType; occurredAt: Date }> = [
    { eventType: "in", occurredAt: inAt },
  ];
  const bs = emptyToNull(parsed.data.breakStart);
  const be = emptyToNull(parsed.data.breakEnd);
  if (bs && be) {
    const bsAt = combine(bs);
    const beAt = combine(be);
    if (
      Number.isNaN(bsAt.getTime()) ||
      Number.isNaN(beAt.getTime()) ||
      bsAt.getTime() <= inAt.getTime() ||
      beAt.getTime() <= bsAt.getTime() ||
      beAt.getTime() >= outAt.getTime()
    ) {
      console.warn("[addTimesheetEntryAction] break must sit inside the shift");
      return;
    }
    punches.push({ eventType: "break_start", occurredAt: bsAt });
    punches.push({ eventType: "break_end", occurredAt: beAt });
  }
  punches.push({ eventType: "out", occurredAt: outAt });

  // The whole entry lands in one week; lock-check once up front.
  const lockErr = await assertWeekUnlocked(g.tenantId, parsed.data.appUserId, inAt);
  if (lockErr) {
    console.warn("[addTimesheetEntryAction] locked:", lockErr);
    return;
  }

  const locationId = emptyToNull(parsed.data.locationId);
  const insertedIds: string[] = [];
  for (const p of punches) {
    const stateErr = await validateInsertion(
      g.tenantId,
      parsed.data.appUserId,
      p.eventType,
      p.occurredAt,
    );
    if (stateErr) {
      console.warn("[addTimesheetEntryAction] state-machine reject:", stateErr);
      return;
    }
    await forTenant(g.tenantId).run(async (tx) => {
      const [inserted] = await tx
        .insert(scClockEvents)
        .values({
          traceyTenantId: g.tenantId,
          appUserId: parsed.data.appUserId,
          eventType: p.eventType,
          occurredAt: p.occurredAt,
          locationId,
          source: "admin_edit",
          notes: parsed.data.reason,
        })
        .returning({ id: scClockEvents.id });
      insertedIds.push(inserted!.id);
    });
  }

  await logAuditEvent({
    action: "shiftcraft.clock.entry_added",
    targetKind: "sc_clock_event",
    targetId: insertedIds[0],
    details: {
      appUserId: parsed.data.appUserId,
      date: parsed.data.date,
      clockIn: parsed.data.clockIn,
      clockOut: parsed.data.clockOut,
      breakStart: bs,
      breakEnd: be,
      punches: insertedIds.length,
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/app/timesheets");
}

export async function editClockEventAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[editClockEventAction] refused:", g.message);
    return;
  }
  const parsed = editSchema.safeParse({
    originalEventId: formData.get("originalEventId"),
    occurredAt: formData.get("occurredAt"),
    locationId: formData.get("locationId") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[editClockEventAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return;
  }

  const occurredAt = new Date(parsed.data.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return;

  // Load the original so we know its app_user_id + event_type (the edit
  // can't change those — that's the void-and-add use case instead).
  const [original] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({
        id: scClockEvents.id,
        appUserId: scClockEvents.appUserId,
        eventType: scClockEvents.eventType,
        voidedAt: scClockEvents.voidedAt,
      })
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.id, parsed.data.originalEventId),
          eq(scClockEvents.traceyTenantId, g.tenantId),
        ),
      )
      .limit(1),
  );
  if (!original) {
    console.warn("[editClockEventAction] original not found");
    return;
  }
  if (original.voidedAt) {
    console.warn("[editClockEventAction] original already voided");
    return;
  }

  // Lock check covers BOTH the new occurredAt (target week) and — when
  // the edit moves the punch across a week boundary — implicitly the
  // source week too via the void+insert flow below. We check the
  // target week here since that's where the inserted row lands.
  const lockErr = await assertWeekUnlocked(
    g.tenantId,
    original.appUserId,
    occurredAt,
  );
  if (lockErr) {
    console.warn("[editClockEventAction] locked:", lockErr);
    return;
  }

  const stateErr = await validateInsertion(
    g.tenantId,
    original.appUserId,
    original.eventType as ScClockEventType,
    occurredAt,
    original.id,
  );
  if (stateErr) {
    console.warn("[editClockEventAction] state-machine reject:", stateErr);
    return;
  }

  let newEventId = "";
  await forTenant(g.tenantId).run(async (tx) => {
    // Void the original first so the insert sees a clean stream.
    await tx
      .update(scClockEvents)
      .set({
        voidedAt: new Date(),
        voidedByUserId: g.meId,
        voidReason: parsed.data.reason,
      })
      .where(
        and(
          eq(scClockEvents.id, original.id),
          eq(scClockEvents.traceyTenantId, g.tenantId),
        ),
      );
    const [inserted] = await tx
      .insert(scClockEvents)
      .values({
        traceyTenantId: g.tenantId,
        appUserId: original.appUserId,
        eventType: original.eventType,
        occurredAt,
        locationId: emptyToNull(parsed.data.locationId),
        source: "admin_edit",
        notes: parsed.data.reason,
      })
      .returning({ id: scClockEvents.id });
    newEventId = inserted!.id;
  });

  await logAuditEvent({
    action: "shiftcraft.clock.edited",
    targetKind: "sc_clock_event",
    targetId: newEventId,
    details: {
      originalEventId: original.id,
      appUserId: original.appUserId,
      eventType: original.eventType,
      occurredAt: occurredAt.toISOString(),
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/app/timesheets");
}

// Auto clock-out for forgotten punches. For every employee still clocked in
// whose SCHEDULED shift started more than 24h ago, insert a closing `out`
// event at that shift's scheduled end (the payroll-sane finish), source
// 'admin_edit'. Only touches people who were actually scheduled — an open
// punch with no matching accepted shift, or one whose shift started <24h ago,
// is left alone. Locked (approved) weeks and invalid transitions are skipped.
//
// Two entry points: the manual "Close stale clock-ins" button
// (closeStaleClockInsAction, manager-gated) and an automatic throttled sweep
// (maybeSweepStaleClockIns) fired on page loads. Both share sweepStaleClockIns.
const STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;
const SHIFT_MATCH_WINDOW_MS = 12 * 60 * 60 * 1000;
// Auto-sweep at most once per hour per tenant per server instance. In-memory
// (no migration); resets on deploy/restart, which is harmless because the
// sweep is idempotent.
const SWEEP_THROTTLE_MS = 60 * 60 * 1000;
const lastSweepByTenant = new Map<string, number>();

// Core sweep — tenant-scoped, NO auth gate and NO revalidate. Shared by the
// manual action and the throttled auto-trigger; callers add what they need.
async function sweepStaleClockIns(
  tenantId: string,
): Promise<{ closed: number; skipped: number }> {
  const now = new Date();

  // 1. Pull every active (non-voided) event, ordered by user then time, and
  //    derive each user's current open clock-in (the `in` that started the
  //    still-open work period) plus their latest event.
  const events = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        appUserId: scClockEvents.appUserId,
        eventType: scClockEvents.eventType,
        occurredAt: scClockEvents.occurredAt,
      })
      .from(scClockEvents)
      .where(isNull(scClockEvents.voidedAt))
      .orderBy(asc(scClockEvents.appUserId), asc(scClockEvents.occurredAt)),
  );

  interface OpenUser {
    appUserId: string;
    inAt: Date;
    lastEventAt: Date;
  }
  const open = new Map<string, { status: ClockStatusLite; inAt: Date | null; lastEventAt: Date }>();
  type ClockStatusLite = "clocked_out" | "working" | "on_break";
  for (const e of events) {
    let s = open.get(e.appUserId);
    if (!s) {
      s = { status: "clocked_out", inAt: null, lastEventAt: e.occurredAt };
      open.set(e.appUserId, s);
    }
    s.lastEventAt = e.occurredAt;
    switch (e.eventType) {
      case "in":
        if (s.status === "clocked_out") {
          s.status = "working";
          s.inAt = e.occurredAt;
        }
        break;
      case "break_start":
        if (s.status === "working") s.status = "on_break";
        break;
      case "break_end":
        if (s.status === "on_break") s.status = "working";
        break;
      case "out":
        if (s.status !== "clocked_out") {
          s.status = "clocked_out";
          s.inAt = null;
        }
        break;
      default:
        break;
    }
  }
  const openUsers: OpenUser[] = [...open.entries()]
    .filter(([, s]) => s.status !== "clocked_out" && s.inAt !== null)
    .map(([appUserId, s]) => ({ appUserId, inAt: s.inAt!, lastEventAt: s.lastEventAt }));

  let closed = 0;
  let skipped = 0;

  for (const u of openUsers) {
    // 2. Find the accepted scheduled shift this clock-in belongs to — the one
    //    whose start sits within ±12h of the punch (nearest wins).
    const candidates = await forTenant(tenantId).run((tx) =>
      tx
        .select({ startsAt: scShifts.startsAt, endsAt: scShifts.endsAt })
        .from(scShiftAssignments)
        .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
        .where(
          and(
            eq(scShiftAssignments.status, "accepted"),
            eq(scShiftAssignments.userId, u.appUserId),
            eq(scShifts.traceyTenantId, tenantId),
            gte(scShifts.startsAt, new Date(u.inAt.getTime() - SHIFT_MATCH_WINDOW_MS)),
            lt(scShifts.startsAt, new Date(u.inAt.getTime() + SHIFT_MATCH_WINDOW_MS)),
          ),
        ),
    );
    if (candidates.length === 0) continue; // not scheduled → leave alone

    const shift = candidates.reduce((best, c) =>
      Math.abs(c.startsAt.getTime() - u.inAt.getTime()) <
      Math.abs(best.startsAt.getTime() - u.inAt.getTime())
        ? c
        : best,
    );

    // 3. Only auto-close once 24h have elapsed since the scheduled start.
    if (now.getTime() - shift.startsAt.getTime() <= STALE_CUTOFF_MS) continue;

    const outAt = shift.endsAt;
    // The closing punch must land after the last existing event, else the
    // stream/transition would be invalid. (Edge: events after scheduled end.)
    if (outAt.getTime() <= u.lastEventAt.getTime()) {
      skipped++;
      continue;
    }

    const lockErr = await assertWeekUnlocked(tenantId, u.appUserId, outAt);
    if (lockErr) {
      skipped++;
      continue;
    }
    const stateErr = await validateInsertion(tenantId, u.appUserId, "out", outAt);
    if (stateErr) {
      skipped++;
      continue;
    }

    let newEventId = "";
    await forTenant(tenantId).run(async (tx) => {
      const [inserted] = await tx
        .insert(scClockEvents)
        .values({
          traceyTenantId: tenantId,
          appUserId: u.appUserId,
          eventType: "out",
          occurredAt: outAt,
          source: "admin_edit",
          notes: "Auto clock-out: still clocked in 24h+ after scheduled start.",
        })
        .returning({ id: scClockEvents.id });
      newEventId = inserted!.id;
    });

    await logAuditEvent({
      action: "shiftcraft.clock.auto_closed",
      targetKind: "sc_clock_event",
      targetId: newEventId,
      details: {
        appUserId: u.appUserId,
        clockInAt: u.inAt.toISOString(),
        scheduledStart: shift.startsAt.toISOString(),
        clockedOutAt: outAt.toISOString(),
      },
    });
    closed++;
  }

  return { closed, skipped };
}

// Manual trigger — the "Close stale clock-ins" button on the timesheets page.
// Manager-gated; revalidates so the closed punches show immediately.
export async function closeStaleClockInsAction(): Promise<{
  ok: boolean;
  closed: number;
  skipped: number;
  message?: string;
}> {
  const g = await gate();
  if (!g.ok) return { ok: false, closed: 0, skipped: 0, message: g.message };
  const r = await sweepStaleClockIns(g.tenantId);
  if (r.closed > 0) revalidatePath("/app/timesheets");
  return { ok: true, ...r };
}

// Automatic trigger — call from frequently-loaded server components (timesheets,
// clock, kiosk) BEFORE their own data queries, so any auto-closes are read back
// naturally without a revalidate. Throttled to once/hour per tenant and fully
// best-effort: it never throws into the caller's render, and a transient
// failure just means the next eligible page load tries again.
export async function maybeSweepStaleClockIns(tenantId: string): Promise<void> {
  const now = Date.now();
  const last = lastSweepByTenant.get(tenantId) ?? 0;
  if (now - last < SWEEP_THROTTLE_MS) return;
  // Claim the slot before awaiting so concurrent requests don't double-run.
  lastSweepByTenant.set(tenantId, now);
  try {
    await sweepStaleClockIns(tenantId);
  } catch (err) {
    console.warn("[maybeSweepStaleClockIns] sweep failed:", err);
  }
}

export async function voidClockEventAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[voidClockEventAction] refused:", g.message);
    return;
  }
  const parsed = voidSchema.safeParse({
    eventId: formData.get("eventId"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[voidClockEventAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return;
  }

  // Look up the event's owner + timing so we can lock-check before the
  // mutating UPDATE. Skip if already voided or not in this tenant.
  const [existing] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({
        appUserId: scClockEvents.appUserId,
        occurredAt: scClockEvents.occurredAt,
        voidedAt: scClockEvents.voidedAt,
      })
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.id, parsed.data.eventId),
          eq(scClockEvents.traceyTenantId, g.tenantId),
        ),
      )
      .limit(1),
  );
  if (!existing || existing.voidedAt) {
    console.warn("[voidClockEventAction] not found or already voided");
    return;
  }
  const lockErr = await assertWeekUnlocked(
    g.tenantId,
    existing.appUserId,
    existing.occurredAt,
  );
  if (lockErr) {
    console.warn("[voidClockEventAction] locked:", lockErr);
    return;
  }

  await forTenant(g.tenantId).run((tx) =>
    tx
      .update(scClockEvents)
      .set({
        voidedAt: new Date(),
        voidedByUserId: g.meId,
        voidReason: parsed.data.reason,
      })
      .where(
        and(
          eq(scClockEvents.id, parsed.data.eventId),
          eq(scClockEvents.traceyTenantId, g.tenantId),
          isNull(scClockEvents.voidedAt),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.clock.voided",
    targetKind: "sc_clock_event",
    targetId: parsed.data.eventId,
    details: { reason: parsed.data.reason },
  });

  revalidatePath("/app/timesheets");
}
