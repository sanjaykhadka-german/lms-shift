"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  forTenant,
  scClockEvents,
  scLocations,
  type ScClockEventSource,
  type ScClockEventType,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { validateTransition } from "~/lib/clock";
import { findNearestWithinRadius, type GeofenceCandidate } from "~/lib/geofence";

export type PunchResult =
  | { status: "ok" }
  | { status: "error"; message: string };

// Parse a coordinate from a form field. Accepts blank → null; otherwise
// returns a finite number or null on bad input. Tighter than parseFloat
// (which would treat "abc" as NaN and propagate).
function parseCoord(raw: FormDataEntryValue | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

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

  const tenantId = membership.tenant.id;
  const locationIdRaw = String(formData.get("locationId") ?? "").trim();
  let locationId = locationIdRaw.length > 0 ? locationIdRaw : null;
  let source: ScClockEventSource = "manual";
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length > 0 ? notesRaw : null;

  // AUDIT.md #7a — when the client sends a GPS reading, resolve to a
  // location server-side and tag the punch with source='geofence'.
  // The client also pre-fills the locationId in the dropdown for UX,
  // but we re-derive here so a tampered client can't claim a bogus
  // location. If no geofenced location matches the GPS, fall back to
  // whatever the dropdown said (source stays 'manual').
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));
  if (lat != null && lng != null) {
    const candidateRows = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scLocations.id,
          name: scLocations.name,
          lat: scLocations.lat,
          lng: scLocations.lng,
          radiusM: scLocations.geofenceRadiusM,
        })
        .from(scLocations)
        .where(
          and(
            eq(scLocations.traceyTenantId, tenantId),
            isNotNull(scLocations.lat),
            isNotNull(scLocations.lng),
            isNotNull(scLocations.geofenceRadiusM),
          ),
        ),
    );
    const candidates: GeofenceCandidate[] = candidateRows
      .filter(
        (r): r is { id: string; name: string; lat: number; lng: number; radiusM: number } =>
          r.lat != null && r.lng != null && r.radiusM != null,
      )
      .map((r) => ({
        locationId: r.id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        radiusM: r.radiusM,
      }));
    const match = findNearestWithinRadius(lat, lng, candidates);
    if (match) {
      locationId = match.locationId;
      source = "geofence";
    }
  }

  // Enforce a valid state transition based on the most recent event. The DB
  // can't enforce this with a CHECK (it's stream-state, not row-state) so
  // we guard in code. Worst case under a race condition is two clock_in
  // events back-to-back — `deriveClockState` ignores the second so the
  // downstream timesheet aggregation is still correct, but blocking up
  // front gives a friendlier error.
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
      source,
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
