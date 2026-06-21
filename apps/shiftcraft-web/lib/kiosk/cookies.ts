import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-signed cookies for the on-premise kiosk. Two independent identities:
//
//   kiosk.device  — long-lived, HttpOnly. Issued at /kiosk/pair when a
//                   single-use pairing code is claimed (or by the one-tap
//                   "use this device as a kiosk" admin action). Carries
//                   {deviceId, tenantId, locationId}. Set with an explicit
//                   far-future Max-Age (KIOSK_DEVICE_MAX_AGE) so it survives
//                   browser restarts — without it the cookie is a SESSION
//                   cookie and the device silently un-pairs whenever the
//                   kiosk's browser/PWA session ends. Stays valid until the
//                   admin revokes the device (sc_kiosk_devices.revoked_at).
//                   Verified on every /kiosk/* request.
//
//   kiosk.actor   — short-lived (60 sec), HttpOnly. Issued after a correct
//                   PIN. Carries {appUserId, deviceId} plus iat/exp.
//                   Scoped narrowly so a kiosk left unattended after a
//                   single punch doesn't keep someone else signed in.
//
// CRITICAL SECURITY PROPERTY: neither cookie grants access to /app/*. They
// are namespaced under /kiosk only, and the existing auth.config.ts /app
// gate is session-cookie based — kiosk cookies have no overlap with the
// Auth.js session cookie.

export const KIOSK_DEVICE_COOKIE = "kiosk.device";
export const KIOSK_ACTOR_COOKIE = "kiosk.actor";

export interface DeviceClaim {
  deviceId: string;
  tenantId: string;
  locationId: string;
  /** Issued-at (unix seconds). Lets us add a "trust horizon" knob later. */
  iat: number;
}

export interface ActorClaim {
  appUserId: string;
  deviceId: string;
  iat: number;
  /** Hard expiry (unix seconds). Always enforced on verify. */
  exp: number;
}

function requireSecret(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 32) {
    throw new Error(
      `[kiosk] env var ${name} must be set (>=32 chars). ` +
        `Add it to .env — generate with: openssl rand -base64 48`,
    );
  }
  return v;
}

function b64url(b: Buffer): string {
  return b.toString("base64url");
}

function unb64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(secret: string, payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function verify<T>(secret: string, value: string): T | null {
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const provided = value.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = unb64url(provided);
  const b = unb64url(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(unb64url(body).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function signDeviceCookie(
  claim: Omit<DeviceClaim, "iat">,
): string {
  return sign(requireSecret("KIOSK_DEVICE_SECRET"), {
    ...claim,
    iat: Math.floor(Date.now() / 1000),
  });
}

export function verifyDeviceCookie(
  value: string | undefined,
): DeviceClaim | null {
  if (!value) return null;
  return verify<DeviceClaim>(requireSecret("KIOSK_DEVICE_SECRET"), value);
}

export function signActorCookie(
  claim: Omit<ActorClaim, "iat" | "exp">,
  ttlSec = 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  return sign(requireSecret("KIOSK_ACTOR_SECRET"), {
    ...claim,
    iat: now,
    exp: now + ttlSec,
  });
}

export function verifyActorCookie(
  value: string | undefined,
): ActorClaim | null {
  if (!value) return null;
  const claim = verify<ActorClaim>(
    requireSecret("KIOSK_ACTOR_SECRET"),
    value,
  );
  if (!claim) return null;
  if (claim.exp < Math.floor(Date.now() / 1000)) return null;
  return claim;
}

// Common cookie options shared by both kiosk cookies. SameSite=Lax (NOT
// Strict): the device cookie is Set-Cookie'd by /kiosk/pair on a 302 to
// /kiosk, and the pairing link is typically opened from OUTSIDE the site (a
// QR-scanner app, a pasted URL, a chat link). With Strict, that cross-site
// entry chain means the just-set cookie isn't sent on the redirected /kiosk
// request, so the device shows as "not paired". Lax still sends the cookie on
// top-level navigations (the redirect) while blocking cross-site sub-requests,
// which is the protection we actually want. HttpOnly; Secure in prod; Path=/
// so the cookie is visible to all kiosk routes.
export const KIOSK_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

// Max-Age (seconds) for the device cookie. ~5 years — effectively permanent
// for a wall-mounted kiosk. MUST be set explicitly on every device-cookie
// Set-Cookie; the base opts above intentionally omit maxAge so the actor
// cookie can stay short-lived. The device stays paired until an admin
// revokes it server-side (sc_kiosk_devices.revoked_at), independent of this.
export const KIOSK_DEVICE_MAX_AGE = 60 * 60 * 24 * 365 * 5;
