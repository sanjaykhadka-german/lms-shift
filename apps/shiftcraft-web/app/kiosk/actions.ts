"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  forTenant,
  scClockEventPhotos,
  scClockEvents,
  scEmployeePins,
  scKioskDevices,
  type ScClockEventType,
  type ScSelfieStatus,
} from "@tracey/db";
import { verifyPassword } from "~/lib/auth/passwords";
import { validateTransition } from "~/lib/clock";
import {
  KIOSK_ACTOR_COOKIE,
  KIOSK_COOKIE_OPTS,
  KIOSK_DEVICE_COOKIE,
  signActorCookie,
  verifyActorCookie,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";

// In-memory rate-limit window per device. Single-instance memory is fine
// because every kiosk talks to one app instance (each kiosk tablet has a
// pinned origin) and the limit is a UX guard, not a security boundary —
// the real defence is bcrypt cost making brute-force impractical anyway.
// If we ever go multi-instance behind a load balancer we'd promote this
// to a small Postgres row keyed on device_id.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
// Loose UUID guard for the name-select flow's appUserId field.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const attempts = new Map<string, RateLimitEntry>();

function rateLimitCheck(deviceId: string): {
  locked: boolean;
  resetInSec: number;
} {
  const now = Date.now();
  const entry = attempts.get(deviceId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    attempts.set(deviceId, { count: 1, windowStart: now });
    return { locked: false, resetInSec: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const resetInSec = Math.ceil(
      (RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000,
    );
    return { locked: true, resetInSec };
  }
  return { locked: false, resetInSec: 0 };
}

function rateLimitClear(deviceId: string): void {
  attempts.delete(deviceId);
}

export type SubmitPinState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "locked"; resetInSec: number };

export async function submitPinAction(
  _prev: SubmitPinState,
  formData: FormData,
): Promise<SubmitPinState> {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  if (!deviceClaim) {
    return { status: "error", message: "Kiosk not paired." };
  }

  const pin = String(formData.get("pin") ?? "").trim();
  if (!/^\d{4}$/.test(pin)) {
    return { status: "error", message: "Enter your 4-digit PIN." };
  }

  // Rate-limit check BEFORE the bcrypt loop so a flood of bad guesses
  // doesn't even hit the database.
  const rl = rateLimitCheck(deviceClaim.deviceId);
  if (rl.locked) {
    return { status: "locked", resetInSec: rl.resetInSec };
  }

  // Name-select flow: the kiosk sends the chosen employee's id, so we verify
  // the PIN against just that one person. This both scopes the bcrypt work to
  // a single hash and means a duplicate PIN can never clock the wrong person
  // (the name already identifies them).
  const targetUserId = String(formData.get("appUserId") ?? "").trim();

  let matched: { appUserId: string } | null = null;

  if (UUID_RE.test(targetUserId)) {
    const [row] = await forTenant(deviceClaim.tenantId).run((tx) =>
      tx
        .select({ pinHash: scEmployeePins.pinHash })
        .from(scEmployeePins)
        .where(
          and(
            eq(scEmployeePins.traceyTenantId, deviceClaim.tenantId),
            eq(scEmployeePins.appUserId, targetUserId),
          ),
        )
        .limit(1),
    );
    if (row && (await verifyPassword(pin, row.pinHash))) {
      matched = { appUserId: targetUserId };
    }
    if (!matched) {
      return { status: "error", message: "Wrong PIN. Try again." };
    }
  } else {
    // Fallback (no name selected): bcrypt-compare against every PIN row in the
    // tenant. O(N) per submission — fine for a single workplace.
    const candidates = await forTenant(deviceClaim.tenantId).run((tx) =>
      tx
        .select({
          appUserId: scEmployeePins.appUserId,
          pinHash: scEmployeePins.pinHash,
        })
        .from(scEmployeePins)
        .where(eq(scEmployeePins.traceyTenantId, deviceClaim.tenantId)),
    );

    let matchCount = 0;
    for (const c of candidates) {
      if (await verifyPassword(pin, c.pinHash)) {
        matchCount += 1;
        matched = { appUserId: c.appUserId };
      }
    }

    if (matchCount === 0) {
      return { status: "error", message: "Wrong PIN. Try again." };
    }
    if (matchCount > 1) {
      // Duplicate PIN with no name selected — refuse rather than guess.
      console.warn(
        `[kiosk] PIN collision in tenant ${deviceClaim.tenantId} — refusing`,
      );
      return { status: "error", message: "Wrong PIN. Try again." };
    }
  }

  // Success: clear the rate limit, mint a 60-sec actor cookie, redirect.
  rateLimitClear(deviceClaim.deviceId);
  cookieStore.set(
    KIOSK_ACTOR_COOKIE,
    signActorCookie(
      { appUserId: matched!.appUserId, deviceId: deviceClaim.deviceId },
      60,
    ),
    { ...KIOSK_COOKIE_OPTS, maxAge: 60 },
  );

  redirect("/kiosk/me");
}

// Exits the actor session early (e.g. user changed their mind before
// completing a punch). Clears the actor cookie and bounces back to the
// numpad; the device cookie is untouched.
export async function clearActorAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(KIOSK_ACTOR_COOKIE);
  redirect("/kiosk");
}

// Server-side guard for the selfie blob the client sends. Defends against
// a manipulated form posting a 10 MB image to bloat the DB. Allowed inputs:
// data:image/jpeg;base64,<base64>  with decoded size ≤ MAX_SELFIE_BYTES.
// 150 KB headroom for the 640×480 @ q0.6 captures (larger kiosk preview).
const MAX_SELFIE_BYTES = 150 * 1024;
const DATA_URL_RE = /^data:image\/jpeg;base64,(.+)$/i;

interface DecodedSelfie {
  buffer: Buffer;
  mimeType: "image/jpeg";
}

function decodeSelfie(raw: string): DecodedSelfie | null {
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
  return { buffer: buf, mimeType: "image/jpeg" };
}

// Punches the clock from the kiosk. Bound by the client with the eventType
// already chosen ("in" / "out" / "break_start" / "break_end") so the form
// surface stays simple. Selfie blob is optional in the formData — present
// for in/out punches on selfie-enabled devices, absent for breaks or when
// the device has require_selfie=false.
export async function kioskPunchAction(
  eventType: ScClockEventType,
  formData: FormData,
): Promise<void> {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  const actorClaim = verifyActorCookie(
    cookieStore.get(KIOSK_ACTOR_COOKIE)?.value,
  );
  if (
    !deviceClaim ||
    !actorClaim ||
    actorClaim.deviceId !== deviceClaim.deviceId
  ) {
    redirect("/kiosk");
  }

  const tenantId = deviceClaim.tenantId;
  const appUserId = actorClaim.appUserId;

  // Reuse the same transition guard as /app/clock. If the user's state is
  // wrong (e.g. they're already clocked in), redirect with an error rather
  // than throwing; the kiosk page reads ?error= and shows it.
  const last = await forTenant(tenantId).run((tx) =>
    tx
      .select({ eventType: scClockEvents.eventType })
      .from(scClockEvents)
      .where(
        and(
          eq(scClockEvents.appUserId, appUserId),
          isNull(scClockEvents.voidedAt),
        ),
      )
      .orderBy(desc(scClockEvents.occurredAt))
      .limit(1),
  );
  const transitionErr = validateTransition(
    last[0]?.eventType as ScClockEventType | undefined,
    eventType,
  );
  if (transitionErr) {
    cookieStore.delete(KIOSK_ACTOR_COOKIE);
    redirect(
      `/kiosk?error=transition&detail=${encodeURIComponent(transitionErr)}`,
    );
  }

  // Resolve the selfie state. Three modes per the scClockEventPhotos
  // selfie_status enum:
  //   captured     — image present and validates
  //   denied       — device required selfie, user blocked camera
  //   unavailable  — device.require_selfie = false
  let selfieStatus: ScSelfieStatus = "unavailable";
  let selfieBuffer: Buffer | null = null;

  // Only in/out carry selfies. Breaks always skip — quick taps, low fraud
  // signal, friendlier UX.
  if (eventType === "in" || eventType === "out") {
    const [deviceRow] = await forTenant(tenantId).run((tx) =>
      tx
        .select({ requireSelfie: scKioskDevices.requireSelfie })
        .from(scKioskDevices)
        .where(eq(scKioskDevices.id, deviceClaim.deviceId))
        .limit(1),
    );
    if (deviceRow?.requireSelfie) {
      const raw = String(formData.get("selfie") ?? "");
      if (raw.length > 0) {
        const decoded = decodeSelfie(raw);
        if (decoded) {
          selfieStatus = "captured";
          selfieBuffer = decoded.buffer;
        } else {
          // Client sent something we couldn't trust. Treat as denied rather
          // than blocking the punch — the audit chip will surface it.
          selfieStatus = "denied";
        }
      } else {
        selfieStatus = "denied";
      }
    }
  }

  // Write the clock event + the photo row in a single tenant tx so a partial
  // failure can't leave a photo orphaned (FK on photos.clock_event_id would
  // refuse it anyway, but this is more explicit).
  await forTenant(tenantId).run(async (tx) => {
    const [inserted] = await tx
      .insert(scClockEvents)
      .values({
        traceyTenantId: tenantId,
        appUserId,
        locationId: deviceClaim.locationId,
        eventType,
        source: "kiosk",
      })
      .returning({ id: scClockEvents.id });

    if (eventType === "in" || eventType === "out") {
      await tx.insert(scClockEventPhotos).values({
        traceyTenantId: tenantId,
        clockEventId: inserted!.id,
        image: selfieBuffer ?? undefined,
        mimeType: selfieBuffer ? "image/jpeg" : undefined,
        selfieStatus,
      });
    }

    // Refresh the PIN's last_used_at for the manager audit display.
    await tx
      .update(scEmployeePins)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(scEmployeePins.appUserId, appUserId),
          eq(scEmployeePins.traceyTenantId, tenantId),
        ),
      );

    // Bump the device's last_seen_at so the admin device list shows it
    // active right now (we already bumped on /kiosk page load but a punch
    // is a stronger signal).
    await tx
      .update(scKioskDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(scKioskDevices.id, deviceClaim.deviceId));
  });

  // Clear the actor cookie immediately. The 60-sec expiry is a hard cap;
  // we tighten that to "single use per punch" to keep the kiosk safe when
  // multiple staff queue up.
  cookieStore.delete(KIOSK_ACTOR_COOKIE);
  redirect(`/kiosk?punched=${eventType}`);
}
