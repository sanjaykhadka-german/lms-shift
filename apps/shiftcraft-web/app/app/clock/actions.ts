"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { forTenant, scClockEvents, type ScClockEventType } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { validateTransition } from "~/lib/clock";

export type PunchResult =
  | { status: "ok" }
  | { status: "error"; message: string };

async function recordPunch(
  eventType: ScClockEventType,
  formData: FormData,
): Promise<PunchResult> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Not signed in." };
  const membership = await currentMembership();
  if (!membership) {
    return { status: "error", message: "No workspace selected." };
  }

  const locationIdRaw = String(formData.get("locationId") ?? "").trim();
  const locationId = locationIdRaw.length > 0 ? locationIdRaw : null;
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length > 0 ? notesRaw : null;

  // Enforce a valid state transition based on the most recent event. The DB
  // can't enforce this with a CHECK (it's stream-state, not row-state) so
  // we guard in code. Worst case under a race condition is two clock_in
  // events back-to-back — `deriveClockState` ignores the second so the
  // downstream timesheet aggregation is still correct, but blocking up
  // front gives a friendlier error.
  const tenantId = membership.tenant.id;
  const last = await forTenant(tenantId).run((tx) =>
    tx
      .select({ eventType: scClockEvents.eventType })
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, user.id),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(desc(scClockEvents.occurredAt))
      .limit(1),
  );
  const lastType = last[0]?.eventType as ScClockEventType | undefined;
  const transitionError = validateTransition(lastType, eventType);
  if (transitionError) {
    return { status: "error", message: transitionError };
  }

  await forTenant(tenantId).run((tx) =>
    tx.insert(scClockEvents).values({
      traceyTenantId: tenantId,
      appUserId: user.id,
      locationId,
      eventType,
      notes,
      source: "manual",
    }),
  );

  revalidatePath("/app/clock");
  revalidatePath("/app/timesheets");
  revalidatePath("/app");
  return { status: "ok" };
}

export async function clockInAction(
  _prev: PunchResult | undefined,
  formData: FormData,
): Promise<PunchResult> {
  return recordPunch("in", formData);
}

export async function clockOutAction(
  _prev: PunchResult | undefined,
  formData: FormData,
): Promise<PunchResult> {
  return recordPunch("out", formData);
}

export async function breakStartAction(
  _prev: PunchResult | undefined,
  formData: FormData,
): Promise<PunchResult> {
  return recordPunch("break_start", formData);
}

export async function breakEndAction(
  _prev: PunchResult | undefined,
  formData: FormData,
): Promise<PunchResult> {
  return recordPunch("break_end", formData);
}
