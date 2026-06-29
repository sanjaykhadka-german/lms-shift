"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scClockEvents,
  type ScClockEventType,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  assertWeekUnlocked,
  sweepStaleClockIns,
  validateInsertion,
} from "~/lib/clock-sweep";

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
// Breaks arrive as parallel breakStart[]/breakEnd[] inputs (0..N rows), read via
// formData.getAll below — not part of the zod object (which covers the scalars).
const fullEntrySchema = z.object({
  appUserId: z.string().uuid(),
  date: z.string().min(1), // YYYY-MM-DD
  clockIn: z.string().min(1), // HH:MM
  clockOut: z.string().min(1), // HH:MM
  locationId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(1, "Add a note.").max(200),
});

// Result contract so the form can surface a reason instead of silently
// no-op'ing. Every rejection path returns { ok: false, error } with a
// human-readable message; the happy path returns { ok: true }.
export type EntryResult = { ok: true } | { ok: false; error: string };

export async function addTimesheetEntryAction(
  formData: FormData,
): Promise<EntryResult> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[addTimesheetEntryAction] refused:", g.message);
    return { ok: false, error: g.message };
  }
  const parsed = fullEntrySchema.safeParse({
    appUserId: formData.get("appUserId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut"),
    locationId: formData.get("locationId") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[addTimesheetEntryAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return {
      ok: false,
      error: "Choose an employee and fill in the date, start, finish and a note.",
    };
  }

  const combine = (time: string): Date => new Date(`${parsed.data.date}T${time}`);
  const inAt = combine(parsed.data.clockIn);
  const outAt = combine(parsed.data.clockOut);
  if (Number.isNaN(inAt.getTime()) || Number.isNaN(outAt.getTime())) {
    console.warn("[addTimesheetEntryAction] bad date/time");
    return { ok: false, error: "Enter a valid date, start and finish time." };
  }
  if (outAt.getTime() <= inAt.getTime()) {
    console.warn("[addTimesheetEntryAction] finish must be after start");
    return { ok: false, error: "Finish time must be after the start time." };
  }

  // Collect 0..N break segments from the parallel breakStart[]/breakEnd[]
  // inputs. A shift may have no break, one break, or several (item 6) — the
  // structure is in → break_start → break_end → … → out.
  const breakStartRaw = formData.getAll("breakStart").map((v) => String(v));
  const breakEndRaw = formData.getAll("breakEnd").map((v) => String(v));
  const rowCount = Math.max(breakStartRaw.length, breakEndRaw.length);
  const breaks: Array<{ bsAt: Date; beAt: Date }> = [];
  for (let i = 0; i < rowCount; i++) {
    const bs = emptyToNull(breakStartRaw[i]);
    const be = emptyToNull(breakEndRaw[i]);
    if (!bs && !be) continue; // a blank row — ignore
    if (!bs || !be) {
      console.warn("[addTimesheetEntryAction] break row needs both start and end");
      return {
        ok: false,
        error: "Each break needs both a start and an end time.",
      };
    }
    const bsAt = combine(bs);
    const beAt = combine(be);
    if (Number.isNaN(bsAt.getTime()) || Number.isNaN(beAt.getTime())) {
      console.warn("[addTimesheetEntryAction] bad break time");
      return { ok: false, error: "Enter a valid break start and end time." };
    }
    if (beAt.getTime() <= bsAt.getTime()) {
      console.warn("[addTimesheetEntryAction] break end before start");
      return { ok: false, error: "A break's end must be after its start." };
    }
    if (bsAt.getTime() <= inAt.getTime() || beAt.getTime() >= outAt.getTime()) {
      console.warn("[addTimesheetEntryAction] break must sit inside the shift");
      return {
        ok: false,
        error:
          "Breaks must fall inside the shift — after the start and before the finish.",
      };
    }
    breaks.push({ bsAt, beAt });
  }
  // Order chronologically and reject overlapping breaks.
  breaks.sort((a, b) => a.bsAt.getTime() - b.bsAt.getTime());
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i]!.bsAt.getTime() < breaks[i - 1]!.beAt.getTime()) {
      console.warn("[addTimesheetEntryAction] breaks overlap");
      return { ok: false, error: "Breaks can't overlap each other." };
    }
  }

  // Build the punch sequence in chronological order.
  const punches: Array<{ eventType: ScClockEventType; occurredAt: Date }> = [
    { eventType: "in", occurredAt: inAt },
  ];
  for (const b of breaks) {
    punches.push({ eventType: "break_start", occurredAt: b.bsAt });
    punches.push({ eventType: "break_end", occurredAt: b.beAt });
  }
  punches.push({ eventType: "out", occurredAt: outAt });

  // The whole entry lands in one week; lock-check once up front.
  const lockErr = await assertWeekUnlocked(g.tenantId, parsed.data.appUserId, inAt);
  if (lockErr) {
    console.warn("[addTimesheetEntryAction] locked:", lockErr);
    return { ok: false, error: lockErr };
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
      return {
        ok: false,
        error:
          "This entry clashes with punches already recorded for that day. Edit or remove them first.",
      };
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
      breaks: breaks.length,
      punches: insertedIds.length,
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/app/timesheets");
  return { ok: true };
}

// Edit a whole day's entry in one go (clock in + 0..N breaks + clock out),
// replacing whatever punches the day currently has. This is the "edit the whole
// shift" counterpart to addTimesheetEntryAction: it voids the day's existing
// non-voided punches and inserts the new sequence in one transaction, so the
// stream is always left valid. Same-day shifts only (an overnight clock-out on
// the following day is left untouched). Note: replaced punches become
// source='admin_edit', so a kiosk selfie on the old clock-in no longer attaches.
const dayEntrySchema = z.object({
  appUserId: z.string().uuid(),
  date: z.string().min(1), // YYYY-MM-DD
  clockIn: z.string().min(1), // HH:MM
  clockOut: z.string().min(1), // HH:MM
  reason: z.string().trim().min(1, "Add a note.").max(200),
});

export async function editDayEntryAction(
  formData: FormData,
): Promise<EntryResult> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[editDayEntryAction] refused:", g.message);
    return { ok: false, error: g.message };
  }
  const parsed = dayEntrySchema.safeParse({
    appUserId: formData.get("appUserId"),
    date: formData.get("date"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[editDayEntryAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return { ok: false, error: "Fill in the start, finish and a note." };
  }

  const combine = (time: string): Date => new Date(`${parsed.data.date}T${time}`);
  const inAt = combine(parsed.data.clockIn);
  const outAt = combine(parsed.data.clockOut);
  if (Number.isNaN(inAt.getTime()) || Number.isNaN(outAt.getTime())) {
    console.warn("[editDayEntryAction] bad date/time");
    return { ok: false, error: "Enter a valid start and finish time." };
  }
  if (outAt.getTime() <= inAt.getTime()) {
    console.warn("[editDayEntryAction] finish must be after start");
    return { ok: false, error: "Finish time must be after the start time." };
  }

  // Same 0..N break parsing + validation as addTimesheetEntryAction.
  const breakStartRaw = formData.getAll("breakStart").map((v) => String(v));
  const breakEndRaw = formData.getAll("breakEnd").map((v) => String(v));
  const rowCount = Math.max(breakStartRaw.length, breakEndRaw.length);
  const breaks: Array<{ bsAt: Date; beAt: Date }> = [];
  for (let i = 0; i < rowCount; i++) {
    const bs = emptyToNull(breakStartRaw[i]);
    const be = emptyToNull(breakEndRaw[i]);
    if (!bs && !be) continue;
    if (!bs || !be) {
      console.warn("[editDayEntryAction] break row needs both start and end");
      return {
        ok: false,
        error: "Each break needs both a start and an end time.",
      };
    }
    const bsAt = combine(bs);
    const beAt = combine(be);
    if (Number.isNaN(bsAt.getTime()) || Number.isNaN(beAt.getTime())) {
      console.warn("[editDayEntryAction] bad break time");
      return { ok: false, error: "Enter a valid break start and end time." };
    }
    if (beAt.getTime() <= bsAt.getTime()) {
      console.warn("[editDayEntryAction] break end before start");
      return { ok: false, error: "A break's end must be after its start." };
    }
    if (bsAt.getTime() <= inAt.getTime() || beAt.getTime() >= outAt.getTime()) {
      console.warn("[editDayEntryAction] break must sit inside the shift");
      return {
        ok: false,
        error:
          "Breaks must fall inside the shift — after the start and before the finish.",
      };
    }
    breaks.push({ bsAt, beAt });
  }
  breaks.sort((a, b) => a.bsAt.getTime() - b.bsAt.getTime());
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i]!.bsAt.getTime() < breaks[i - 1]!.beAt.getTime()) {
      console.warn("[editDayEntryAction] breaks overlap");
      return { ok: false, error: "Breaks can't overlap each other." };
    }
  }

  const lockErr = await assertWeekUnlocked(g.tenantId, parsed.data.appUserId, inAt);
  if (lockErr) {
    console.warn("[editDayEntryAction] locked:", lockErr);
    return { ok: false, error: lockErr };
  }

  const punches: Array<{ eventType: ScClockEventType; occurredAt: Date }> = [
    { eventType: "in", occurredAt: inAt },
  ];
  for (const b of breaks) {
    punches.push({ eventType: "break_start", occurredAt: b.bsAt });
    punches.push({ eventType: "break_end", occurredAt: b.beAt });
  }
  punches.push({ eventType: "out", occurredAt: outAt });

  const dayStart = combine("00:00");
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  // One transaction: void the day's existing punches, then insert the new
  // sequence. The replacement set is valid by construction (built + validated
  // above), so no per-event state-machine check is needed.
  let insertedCount = 0;
  await forTenant(g.tenantId).run(async (tx) => {
    await tx
      .update(scClockEvents)
      .set({
        voidedAt: new Date(),
        voidedByUserId: g.meId,
        voidReason: parsed.data.reason,
      })
      .where(
        and(
          eq(scClockEvents.traceyTenantId, g.tenantId),
          eq(scClockEvents.appUserId, parsed.data.appUserId),
          isNull(scClockEvents.voidedAt),
          gte(scClockEvents.occurredAt, dayStart),
          lt(scClockEvents.occurredAt, dayEnd),
        ),
      );
    for (const p of punches) {
      await tx.insert(scClockEvents).values({
        traceyTenantId: g.tenantId,
        appUserId: parsed.data.appUserId,
        eventType: p.eventType,
        occurredAt: p.occurredAt,
        source: "admin_edit",
        notes: parsed.data.reason,
      });
      insertedCount += 1;
    }
  });

  await logAuditEvent({
    action: "shiftcraft.clock.day_replaced",
    targetKind: "sc_clock_event",
    targetId: parsed.data.appUserId,
    details: {
      appUserId: parsed.data.appUserId,
      date: parsed.data.date,
      clockIn: parsed.data.clockIn,
      clockOut: parsed.data.clockOut,
      breaks: breaks.length,
      punches: insertedCount,
      reason: parsed.data.reason,
    },
  });

  revalidatePath("/app/timesheets");
  return { ok: true };
}

// Inline break edit (item 5): adjust a break's start AND end times in one go
// from the timesheet expansion, without the per-punch modal. Reuses
// editClockEventAction's proven void+insert per event so audit + state-machine
// validation stay identical. Edits are ordered by the direction the start
// moves so the pair never transiently has start-after-end.
const editBreakSchema = z.object({
  startEventId: z.string().uuid(),
  endEventId: z.string().uuid(),
  startOccurredAt: z.string().min(1), // datetime-local (local tz)
  endOccurredAt: z.string().min(1),
  reason: z.string().trim().min(1, "Add a note.").max(200),
});

export async function editBreakInlineAction(formData: FormData): Promise<void> {
  const g = await gate();
  if (!g.ok) {
    console.warn("[editBreakInlineAction] refused:", g.message);
    return;
  }
  const parsed = editBreakSchema.safeParse({
    startEventId: formData.get("startEventId"),
    endEventId: formData.get("endEventId"),
    startOccurredAt: formData.get("startOccurredAt"),
    endOccurredAt: formData.get("endOccurredAt"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    console.warn(
      "[editBreakInlineAction] invalid:",
      parsed.error.flatten().fieldErrors,
    );
    return;
  }

  const newStart = new Date(parsed.data.startOccurredAt);
  const newEnd = new Date(parsed.data.endOccurredAt);
  if (Number.isNaN(newStart.getTime()) || Number.isNaN(newEnd.getTime())) {
    console.warn("[editBreakInlineAction] bad date/time");
    return;
  }
  if (newEnd.getTime() <= newStart.getTime()) {
    console.warn("[editBreakInlineAction] break end must be after start");
    return;
  }

  // Confirm both events are the break_start/break_end they claim to be, live,
  // and in this tenant. Their current times decide the safe edit order.
  const rows = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({
        id: scClockEvents.id,
        eventType: scClockEvents.eventType,
        occurredAt: scClockEvents.occurredAt,
        voidedAt: scClockEvents.voidedAt,
      })
      .from(scClockEvents)
      .where(
        and(
          inArray(scClockEvents.id, [
            parsed.data.startEventId,
            parsed.data.endEventId,
          ]),
          eq(scClockEvents.traceyTenantId, g.tenantId),
        ),
      ),
  );
  const startRow = rows.find((r) => r.id === parsed.data.startEventId);
  const endRow = rows.find((r) => r.id === parsed.data.endEventId);
  if (!startRow || !endRow) {
    console.warn("[editBreakInlineAction] break events not found");
    return;
  }
  if (
    startRow.eventType !== "break_start" ||
    endRow.eventType !== "break_end" ||
    startRow.voidedAt ||
    endRow.voidedAt
  ) {
    console.warn("[editBreakInlineAction] not an editable break pair");
    return;
  }

  const minute = (d: Date) => Math.floor(d.getTime() / 60_000);
  const startChanged = minute(startRow.occurredAt) !== minute(newStart);
  const endChanged = minute(endRow.occurredAt) !== minute(newEnd);
  if (!startChanged && !endChanged) return; // no-op

  const callEdit = async (id: string, iso: string) => {
    const fd = new FormData();
    fd.set("originalEventId", id);
    fd.set("eventId", id);
    fd.set("occurredAt", iso);
    fd.set("reason", parsed.data.reason);
    await editClockEventAction(fd);
  };

  // If the start is moving later, edit the end first so the intermediate
  // stream never has start beyond end; otherwise edit the start first.
  const startMovingLater = newStart.getTime() > startRow.occurredAt.getTime();
  const ops: Array<() => Promise<void>> = [];
  if (startMovingLater) {
    if (endChanged) ops.push(() => callEdit(parsed.data.endEventId, parsed.data.endOccurredAt));
    if (startChanged) ops.push(() => callEdit(parsed.data.startEventId, parsed.data.startOccurredAt));
  } else {
    if (startChanged) ops.push(() => callEdit(parsed.data.startEventId, parsed.data.startOccurredAt));
    if (endChanged) ops.push(() => callEdit(parsed.data.endEventId, parsed.data.endOccurredAt));
  }
  for (const op of ops) await op();
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

// Auto clock-out lives in ~/lib/clock-sweep so it can also run from the hourly
// cron (scripts/sweep-stale-clock-outs.ts) without pulling Next-only imports.
// Two in-app entry points wrap it here: the manual "Close stale clock-ins"
// button (closeStaleClockInsAction, manager-gated) and the throttled page-load
// sweep (maybeSweepStaleClockIns). A third entry point is the cron.
//
// Auto-sweep at most once per hour per tenant per server instance. In-memory
// (no migration); resets on deploy/restart, which is harmless because the
// sweep is idempotent.
const SWEEP_THROTTLE_MS = 60 * 60 * 1000;
const lastSweepByTenant = new Map<string, number>();

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
