"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";

// Signature blobs are PNG data URLs from the SignaturePad canvas. Cap the
// decoded size so a tampered client can't post a huge blob; validate the PNG
// magic bytes so a renamed file can't slip through.
const MAX_SIGNATURE_BYTES = 200 * 1024;
const PNG_DATA_URL_RE = /^data:image\/png;base64,(.+)$/i;

function decodeSignature(raw: string): Buffer | null {
  const m = PNG_DATA_URL_RE.exec(raw);
  if (!m) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[1]!, "base64");
  } catch {
    return null;
  }
  if (buf.length === 0 || buf.length > MAX_SIGNATURE_BYTES) return null;
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] !== 0x89 ||
    buf[1] !== 0x50 ||
    buf[2] !== 0x4e ||
    buf[3] !== 0x47
  ) {
    return null;
  }
  return buf;
}

function field(formData: FormData, key: string, max: number): string {
  return String(formData.get(key) ?? "")
    .trim()
    .slice(0, max);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sign a visitor in. No actor cookie — visitors aren't employees; identity is
// the free-text details they enter. Tenant + location come from the device
// cookie so the punch is attributed to the right site automatically.
export async function visitorSignInAction(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  if (!deviceClaim) redirect("/kiosk");

  const visitorName = field(formData, "visitorName", 120);
  const visitorCompany = field(formData, "visitorCompany", 120);
  const visitorMobile = field(formData, "visitorMobile", 40);
  const visitingPerson = field(formData, "visitingPerson", 120);
  const visitReason = field(formData, "visitReason", 300);
  const sig = decodeSignature(String(formData.get("signInSignature") ?? ""));

  // Required fields mirror the visitor-app: name, mobile, who they're visiting,
  // and a signature. Bounce back with an error flag if anything's missing.
  if (!visitorName || !visitorMobile || !visitingPerson || !sig) {
    redirect("/kiosk/visitor?error=missing");
  }

  await forTenant(deviceClaim.tenantId).run((tx) =>
    tx.insert(scVisitorSignins).values({
      traceyTenantId: deviceClaim.tenantId,
      locationId: deviceClaim.locationId,
      visitorName,
      visitorCompany: visitorCompany || null,
      visitorMobile,
      visitingPerson,
      visitReason: visitReason || null,
      signInSignature: sig,
      source: "kiosk",
    }),
  );

  redirect("/kiosk/visitor?signed=in");
}

// Sign a visitor out: stamp signed_out_at and store the exit signature if one
// was captured. Scoped to this tenant + still-signed-in rows so a stale id
// can't reopen a closed visit.
export async function visitorSignOutAction(formData: FormData): Promise<void> {
  const cookieStore = await cookies();
  const deviceClaim = verifyDeviceCookie(
    cookieStore.get(KIOSK_DEVICE_COOKIE)?.value,
  );
  if (!deviceClaim) redirect("/kiosk");

  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) redirect("/kiosk/visitor?error=missing");

  const sig = decodeSignature(String(formData.get("signOutSignature") ?? ""));

  await forTenant(deviceClaim.tenantId).run((tx) =>
    tx
      .update(scVisitorSignins)
      .set({
        signedOutAt: new Date(),
        ...(sig ? { signOutSignature: sig } : {}),
      })
      .where(
        and(
          eq(scVisitorSignins.id, id),
          eq(scVisitorSignins.traceyTenantId, deviceClaim.tenantId),
          isNull(scVisitorSignins.signedOutAt),
        ),
      ),
  );

  redirect("/kiosk/visitor?signed=out");
}
