"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  forTenant,
  scClockEventPhotos,
  scClockEvents,
  scLocations,
  type ScClockEventSource,
  type ScClockEventType,
  type ScSelfieStatus,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { validateTransition } from "~/lib/clock";
import { findNearestWithinRadius, type GeofenceCandidate } from "~/lib/geofence";

// AUDIT.md #7b — mobile selfie capture. Mirrors the kiosk's defense in
// apps/shiftcraft-web/app/kiosk/actions.ts so a tampered client can't
// post a 10 MB blob to bloat the DB. Allowed input:
//   data:image/jpeg;base64,<base64>   with decoded size ≤ MAX_SELFIE_BYTES
// 150 KB headroom for the 640×480 @ q0.6 captures (larger preview).
const MAX_SELFIE_BYTES = 150 * 1024;
const DATA_URL_RE = /^data:image\/jpeg;base64,(.+)$/i;

function decodeSelfie(raw: string): { buffer: Buffer } | null {
  const m = DATA_URL_RE.exec(raw);
  if (!m) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[1]!, "base64");
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > MAX_SELFIE_BYTES) return null;
  // JPEG magic bytes: FF D8 FF. Reject anything that doesn't start with
  // them so a renamed PNG / arbitrary blob can't slip through.
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null;
  return { buffer: buf };
}

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

  // AUDIT.md #7b — mobile selfie capture. Only in/out punches carry
  // selfies (breaks are quick taps; low fraud signal). Three states
  // mirror the kiosk's sc_clock_event_photos.selfie_status enum:
  //   captured     — image present + validates
  //   denied       — user closed the modal with Skip OR client blob
  //                  failed validation (size/mime check)
  //   unavailable  — punch didn't go through the selfie flow at all
  let selfieStatus: ScSelfieStatus = "unavailable";
  let selfieBuffer: Buffer | null = null;
  if (eventType === "in" || eventType === "out") {
    const raw = String(formData.get("selfie") ?? "");
    if (raw === "skip") {
      selfieStatus = "denied";
    } else if (raw.length > 0) {
      const decoded = decodeSelfie(raw);
      if (decoded) {
        selfieStatus = "captured";
        selfieBuffer = decoded.buffer;
      } else {
        // Client sent something we couldn't trust. Tag denied + drop
        // the blob rather than blocking the punch — manager sees the
        // chip on the timesheet audit pane.
        selfieStatus = "denied";
      }
    }
  }

  await forTenant(tenantId).run(async (tx) => {
    const [inserted] = await tx
      .insert(scClockEvents)
      .values({
        traceyTenantId: tenantId,
        appUserId: user.id,
        locationId,
        eventType,
        notes,
        source,
      })
      .returning({ id: scClockEvents.id });

    // Skip the photo row entirely on breaks (unavailable + no buffer
    // would emit a null-image row; not worth the extra write).
    if (selfieStatus !== "unavailable") {
      await tx.insert(scClockEventPhotos).values({
        traceyTenantId: tenantId,
        clockEventId: inserted!.id,
        image: selfieBuffer ?? undefined,
        mimeType: selfieBuffer ? "image/jpeg" : undefined,
        selfieStatus,
      });
    }
  });

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
