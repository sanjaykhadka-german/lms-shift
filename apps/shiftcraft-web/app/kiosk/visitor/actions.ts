"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  forTenant,
  scEmployees,
  scKioskDevices,
  scVisitorSignins,
} from "@tracey/db";
import {
  KIOSK_DEVICE_COOKIE,
  verifyDeviceCookie,
} from "~/lib/kiosk/cookies";
import { createNotifications, notifyTenantAdmins } from "~/lib/notifications";

// Signature blobs are PNG data URLs from the SignaturePad canvas. Cap the
// decoded size so a tampered client can't post a huge blob; validate the PNG
// magic bytes so a renamed file can't slip through.
// 1 MB decoded — generous for a high-DPI canvas PNG; the server-action body
// limit (next.config.ts) is 5 MB so this leaves ample headroom.
const MAX_SIGNATURE_BYTES = 1024 * 1024;
const PNG_DATA_URL_RE = /^data:image\/png;base64,(.+)$/i;

// The visitors-policy document version a visitor agrees to at sign-in. Bump
// this (and replace public/visitors-policy.pdf) when the policy is reissued so
// historical sign-ins record which version was actually agreed to.
const VISITORS_POLICY_VERSION = "POL 1.4.1.2 2026";

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

  // Per-kiosk opt-in guard — mirror the page-level check so a tampered POST
  // can't write visitor rows on a kiosk that hasn't enabled the flow.
  const [deviceRow] = await forTenant(deviceClaim.tenantId).run((tx) =>
    tx
      .select({ allowVisitors: scKioskDevices.allowVisitors })
      .from(scKioskDevices)
      .where(eq(scKioskDevices.id, deviceClaim.deviceId))
      .limit(1),
  );
  if (!deviceRow?.allowVisitors) redirect("/kiosk");

  const visitorName = field(formData, "visitorName", 120);
  const visitorCompany = field(formData, "visitorCompany", 120);
  const visitorMobile = field(formData, "visitorMobile", 40);
  const visitingEmployeeId = String(
    formData.get("visitingEmployeeId") ?? "",
  ).trim();
  // Free-text host name, used when the visitor chose "Someone else (not listed)"
  // instead of an employee from the picker.
  const visitingPersonOther = field(formData, "visitingPersonOther", 120);
  const visitReason = field(formData, "visitReason", 300);
  const sig = decodeSignature(String(formData.get("signInSignature") ?? ""));

  // Visitor-policy screening (POL 1.4.1.2). Toggles arrive as "yes"/"no";
  // descriptions only matter when the answer is "yes". The policy checkbox
  // submits "on" when ticked.
  const broughtToolsRaw = String(formData.get("broughtTools") ?? "");
  const recentIllnessRaw = String(formData.get("recentIllness") ?? "");
  const toolsDescription = field(formData, "toolsDescription", 300);
  const illnessDescription = field(formData, "illnessDescription", 300);
  const policyAgreed = formData.get("policyAgreed") === "on";

  // Required fields: name, mobile, a chosen employee, and a signature. Report
  // the SPECIFIC missing field so the banner can say exactly what's wrong
  // (the old generic "missing" made failures impossible to diagnose).
  if (!visitorName || !visitorMobile) {
    redirect("/kiosk/visitor?error=missing");
  }
  // Company and reason are mandatory too — report each specifically so the
  // banner can say exactly what's missing.
  if (!visitorCompany) {
    redirect("/kiosk/visitor?error=company");
  }
  if (!visitReason) {
    redirect("/kiosk/visitor?error=reason");
  }
  // Screening: both toggles must be a clear yes/no, a "yes" needs a
  // description, and the policy must be agreed before anyone can sign in.
  if (
    (broughtToolsRaw !== "yes" && broughtToolsRaw !== "no") ||
    (broughtToolsRaw === "yes" && !toolsDescription)
  ) {
    redirect("/kiosk/visitor?error=tools");
  }
  if (
    (recentIllnessRaw !== "yes" && recentIllnessRaw !== "no") ||
    (recentIllnessRaw === "yes" && !illnessDescription)
  ) {
    redirect("/kiosk/visitor?error=illness");
  }
  if (!policyAgreed) {
    redirect("/kiosk/visitor?error=policy");
  }
  // Host is either a picked employee (UUID) or "Someone else (not listed)"
  // (the OTHER sentinel) with a typed name. Anything else is invalid.
  const hostIsOther = visitingEmployeeId === "__other__";
  if (hostIsOther) {
    if (!visitingPersonOther) {
      redirect("/kiosk/visitor?error=employee");
    }
  } else if (!UUID_RE.test(visitingEmployeeId)) {
    redirect("/kiosk/visitor?error=employee");
  }
  if (!sig) {
    // Diagnostic: print why the signature was rejected so a "I did sign"
    // report can be pinned down from the dev/prod server log.
    const raw = String(formData.get("signInSignature") ?? "");
    console.warn(
      `[kiosk/visitor] signature rejected: rawLen=${raw.length} head=${JSON.stringify(
        raw.slice(0, 40),
      )}`,
    );
    redirect("/kiosk/visitor?error=signature");
  }

  // Resolve the host. For a picked employee we look them up (scoped to this
  // tenant) to store their name + FK and find their login to notify them. For
  // the "Other" path there's no employee row — store the typed name with a null
  // FK and no direct notification target.
  let hostName: string;
  let hostEmployeeId: string | null;
  let hostAppUserId: string | null;
  if (hostIsOther) {
    hostName = visitingPersonOther;
    hostEmployeeId = null;
    hostAppUserId = null;
  } else {
    const [employee] = await forTenant(deviceClaim.tenantId).run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          fullName: scEmployees.fullName,
          appUserId: scEmployees.appUserId,
        })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.id, visitingEmployeeId),
            eq(scEmployees.traceyTenantId, deviceClaim.tenantId),
          ),
        )
        .limit(1),
    );
    if (!employee) {
      redirect("/kiosk/visitor?error=employee");
    }
    hostName = employee.fullName;
    hostEmployeeId = employee.id;
    hostAppUserId = employee.appUserId;
  }

  await forTenant(deviceClaim.tenantId).run((tx) =>
    tx.insert(scVisitorSignins).values({
      traceyTenantId: deviceClaim.tenantId,
      locationId: deviceClaim.locationId,
      visitorName,
      visitorCompany,
      visitorMobile,
      visitingPerson: hostName,
      visitingEmployeeId: hostEmployeeId,
      visitReason,
      signInSignature: sig,
      source: "kiosk",
      broughtTools: broughtToolsRaw === "yes",
      toolsDescription: broughtToolsRaw === "yes" ? toolsDescription : null,
      recentIllness: recentIllnessRaw === "yes",
      illnessDescription:
        recentIllnessRaw === "yes" ? illnessDescription : null,
      policyAgreed: true,
      policyVersion: VISITORS_POLICY_VERSION,
    }),
  );

  // Best-effort: ping the employee being visited (in-app bell + web push) so
  // they know someone's waiting at reception. Skipped if they have no login.
  const visitorLabel = `${visitorName}${
    visitorCompany ? ` (${visitorCompany})` : ""
  }`;
  if (hostAppUserId) {
    await createNotifications(deviceClaim.tenantId, [
      {
        recipientUserId: hostAppUserId,
        kind: "shiftcraft.visitor.sign_in",
        title: "Visitor at reception",
        body: `${visitorLabel} has signed in to see you.`,
        actionUrl: "/app",
      },
    ]);
  }
  // Also alert managers/admins (the reception desk) so a visitor arrival
  // always reaches someone with a login — e.g. when the visited employee is
  // roster-only with no account. Exclude the visited employee so they don't
  // get a duplicate when they're themselves an admin.
  await notifyTenantAdmins(
    deviceClaim.tenantId,
    {
      kind: "shiftcraft.visitor.sign_in",
      title: "Visitor at reception",
      body: `${visitorLabel} signed in to see ${hostName}.`,
      actionUrl: "/app/admin/visitors",
    },
    { excludeUserId: hostAppUserId ?? undefined },
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

  // Visitors sign themselves out by typing their name (matched against the
  // currently signed-in list) rather than picking from a dropdown.
  const nameOut = field(formData, "visitorNameOut", 120);
  if (!nameOut) redirect("/kiosk/visitor?error=missing");

  // Sign-out signature is mandatory (parity with sign-in).
  const sig = decodeSignature(String(formData.get("signOutSignature") ?? ""));
  if (!sig) redirect("/kiosk/visitor?error=signature");

  // Match the typed name against still-signed-in visitors (case-insensitive),
  // most recent first so a repeat-visitor name resolves to their open visit.
  const active = await forTenant(deviceClaim.tenantId).run((tx) =>
    tx
      .select({
        id: scVisitorSignins.id,
        visitorName: scVisitorSignins.visitorName,
      })
      .from(scVisitorSignins)
      .where(
        and(
          eq(scVisitorSignins.traceyTenantId, deviceClaim.tenantId),
          isNull(scVisitorSignins.signedOutAt),
        ),
      )
      .orderBy(desc(scVisitorSignins.signedInAt)),
  );
  const target = active.find(
    (v) => v.visitorName.trim().toLowerCase() === nameOut.toLowerCase(),
  );
  if (!target) redirect("/kiosk/visitor?error=notfound");

  await forTenant(deviceClaim.tenantId).run((tx) =>
    tx
      .update(scVisitorSignins)
      .set({
        signedOutAt: new Date(),
        signOutSignature: sig,
      })
      .where(
        and(
          eq(scVisitorSignins.id, target.id),
          eq(scVisitorSignins.traceyTenantId, deviceClaim.tenantId),
          isNull(scVisitorSignins.signedOutAt),
        ),
      ),
  );

  redirect("/kiosk/visitor?signed=out");
}
