// GET /kiosk/pair?code=ABCD…&t=<tenantUuid>
//
// Single-purpose route handler that exchanges a single-use pairing code
// for a long-lived device cookie. Implemented as a Route Handler (rather
// than a page) so the request can both Set-Cookie AND redirect in one
// turn — something Server Components can't do.
//
// Lookup flow:
//   1. Read code + tenant from query string. Tenant is required because
//      pairing codes are unique within a tenant (partial unique index in
//      sc_kiosk_devices) — without it we'd need to fan out across all
//      tenant schemas to find the row.
//   2. Inside forTenant(tenant).run(), atomically claim:
//        UPDATE sc_kiosk_devices
//        SET pairing_code = NULL, pairing_expires_at = NULL,
//            paired_at = now(), last_seen_at = now()
//        WHERE pairing_code = $code
//          AND pairing_expires_at > now()
//          AND revoked_at IS NULL
//        RETURNING id, location_id
//      If no rows return, the code was wrong / expired / already claimed
//      / belongs to a revoked device. Redirect to /kiosk?error=...
//   3. On success: sign a device cookie carrying {deviceId, tenantId,
//      locationId} and redirect to /kiosk.

import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { forTenant, scKioskDevices } from "@tracey/db";
import {
  KIOSK_COOKIE_OPTS,
  KIOSK_DEVICE_COOKIE,
  KIOSK_DEVICE_MAX_AGE,
  signDeviceCookie,
} from "~/lib/kiosk/cookies";

// Basic format guard before we hit the DB. The pairing code is 12 chars
// from a 28-symbol alphabet (see admin/kiosks/actions.ts).
const CODE_RE = /^[A-Z2-9]{12}$/;
// Loose UUID-ish guard. Real validation is the FK + WHERE clause below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Render's proxy serves the app on an internal port (request.url comes
// through as http://localhost:10000/kiosk/pair?...). Resolving the
// redirect target against that would point the kiosk's browser back at
// the proxy's internal address. Build the public origin from the
// forwarded headers so the Location header points at the real hostname.
function publicOrigin(request: Request): string {
  const h = request.headers;
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host =
    h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4100";
  return `${proto}://${host}`;
}

function errorRedirect(origin: string, reason: string): NextResponse {
  const target = new URL("/kiosk", origin);
  target.searchParams.set("error", reason);
  return NextResponse.redirect(target);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const code = (url.searchParams.get("code") ?? "").trim();
  const tenantId = (url.searchParams.get("t") ?? "").trim();

  if (!CODE_RE.test(code) || !UUID_RE.test(tenantId)) {
    return errorRedirect(origin, "bad_link");
  }

  let claimed: { id: string; locationId: string } | null = null;
  try {
    const rows = await forTenant(tenantId).run((tx) =>
      tx
        .update(scKioskDevices)
        .set({
          pairingCode: null,
          pairingExpiresAt: null,
          pairedAt: new Date(),
          lastSeenAt: new Date(),
        })
        .where(
          and(
            eq(scKioskDevices.traceyTenantId, tenantId),
            eq(scKioskDevices.pairingCode, code),
            sql`${scKioskDevices.pairingExpiresAt} > now()`,
            isNull(scKioskDevices.revokedAt),
          ),
        )
        .returning({
          id: scKioskDevices.id,
          locationId: scKioskDevices.locationId,
        }),
    );
    claimed = rows[0] ?? null;
  } catch (err) {
    // Tenant id that doesn't resolve to a schema throws — treat as bad link.
    console.error("[kiosk/pair] claim failed:", err);
    return errorRedirect(origin, "bad_link");
  }

  if (!claimed) {
    return errorRedirect(origin, "code_invalid");
  }

  const cookieValue = signDeviceCookie({
    deviceId: claimed.id,
    tenantId,
    locationId: claimed.locationId,
  });

  const response = NextResponse.redirect(new URL("/kiosk", origin));
  response.cookies.set(KIOSK_DEVICE_COOKIE, cookieValue, {
    ...KIOSK_COOKIE_OPTS,
    maxAge: KIOSK_DEVICE_MAX_AGE,
  });
  return response;
}
