"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scClockEvents,
  type ScClockEventType,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { validateTransition } from "~/lib/clock";
import { logAuditEvent } from "~/lib/audit";

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
