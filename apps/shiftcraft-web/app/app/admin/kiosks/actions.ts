"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scKioskDevices, scLocations } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

// Pairing codes are short (12 chars, alphanumeric, uppercase, omitting
// ambiguous glyphs 0/O/1/I/L) so the operator can read or type them
// quickly. 12 chars over a 28-symbol alphabet ≈ 2^57 — more than enough
// entropy for a 15-min single-use window.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const PAIRING_TTL_MS = 15 * 60 * 1000;

function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

const pairSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Give the kiosk a label so you can recognise it later.")
    .max(80, "Too long."),
  locationId: z.string().uuid("Pick a location."),
  requireSelfie: z.string().optional(),
});

export type PairFormState =
  | { status: "idle" }
  | { status: "ok"; deviceId: string }
  | { status: "error"; message: string };

export async function pairKioskAction(
  _prev: PairFormState,
  formData: FormData,
): Promise<PairFormState> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "You don't have permission to pair kiosks.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = pairSchema.safeParse({
    label: formData.get("label"),
    locationId: formData.get("locationId"),
    requireSelfie: formData.get("requireSelfie") ?? undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.errors[0]?.message ?? "Invalid input.",
    };
  }

  // Verify the location belongs to this tenant before creating the kiosk.
  // Otherwise a manipulated form value could pin a kiosk to a sibling
  // tenant's location (FK would catch it but the error message would be
  // worse than this explicit check).
  const locExists = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scLocations.id })
      .from(scLocations)
      .where(
        and(
          eq(scLocations.id, parsed.data.locationId),
          eq(scLocations.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (locExists.length === 0) {
    return { status: "error", message: "Selected location not found." };
  }

  const me = await currentUser();
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

  let deviceId = "";
  await forTenant(tenantId).run(async (tx) => {
    const inserted = await tx
      .insert(scKioskDevices)
      .values({
        traceyTenantId: tenantId,
        label: parsed.data.label,
        locationId: parsed.data.locationId,
        pairingCode: code,
        pairingExpiresAt: expiresAt,
        requireSelfie: parsed.data.requireSelfie === "on",
        createdByUserId: me?.id ?? null,
      })
      .returning({ id: scKioskDevices.id });
    deviceId = inserted[0]!.id;
  });

  await logAuditEvent({
    action: "shiftcraft.kiosk.paired",
    targetKind: "sc_kiosk_device",
    targetId: deviceId,
    details: {
      label: parsed.data.label,
      locationId: parsed.data.locationId,
      requireSelfie: parsed.data.requireSelfie === "on",
    },
  });

  revalidatePath("/app/admin/kiosks");
  return { status: "ok", deviceId };
}

export async function revokeKioskAction(formData: FormData): Promise<void> {
  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) return;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scKioskDevices)
      .set({ revokedAt: new Date(), pairingCode: null, pairingExpiresAt: null })
      .where(
        and(
          eq(scKioskDevices.id, deviceId),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.kiosk.revoked",
    targetKind: "sc_kiosk_device",
    targetId: deviceId,
  });

  revalidatePath("/app/admin/kiosks");
}

// Hard delete — only permitted on already-revoked rows. Forces the operator
// through Revoke first so an active kiosk can't be wiped from under live
// use. Past punches at the device's location stay intact in sc_clock_events
// (they're keyed on location_id + source='kiosk', not on the kiosk row),
// so timesheets and the employee-side history keep working — only the
// device-detail audit page at /app/admin/kiosks/<id> stops resolving.
export async function deleteKioskAction(formData: FormData): Promise<void> {
  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) return;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        revokedAt: scKioskDevices.revokedAt,
        label: scKioskDevices.label,
      })
      .from(scKioskDevices)
      .where(
        and(
          eq(scKioskDevices.id, deviceId),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row || !row.revokedAt) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scKioskDevices)
      .where(
        and(
          eq(scKioskDevices.id, deviceId),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.kiosk.deleted",
    targetKind: "sc_kiosk_device",
    targetId: deviceId,
    details: { label: row.label },
  });

  revalidatePath("/app/admin/kiosks");
  redirect("/app/admin/kiosks");
}

export async function toggleSelfieRequiredAction(
  formData: FormData,
): Promise<void> {
  const deviceId = String(formData.get("deviceId") ?? "");
  const next = formData.get("next") === "on";
  if (!deviceId) return;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scKioskDevices)
      .set({ requireSelfie: next })
      .where(
        and(
          eq(scKioskDevices.id, deviceId),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: next
      ? "shiftcraft.kiosk.selfie_required_on"
      : "shiftcraft.kiosk.selfie_required_off",
    targetKind: "sc_kiosk_device",
    targetId: deviceId,
  });

  revalidatePath("/app/admin/kiosks");
  revalidatePath(`/app/admin/kiosks/${deviceId}`);
}

// Used when a pairing code expires before the device claims it — the
// operator can mint a new 15-min window without recreating the device.
// Also resets revoked_at so a previously-revoked device can be re-paired.
export async function regeneratePairingCodeAction(
  formData: FormData,
): Promise<void> {
  const deviceId = String(formData.get("deviceId") ?? "");
  if (!deviceId) return;

  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scKioskDevices)
      .set({
        pairingCode: code,
        pairingExpiresAt: expiresAt,
        pairedAt: null,
        revokedAt: null,
      })
      .where(
        and(
          eq(scKioskDevices.id, deviceId),
          eq(scKioskDevices.traceyTenantId, tenantId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.kiosk.code_regenerated",
    targetKind: "sc_kiosk_device",
    targetId: deviceId,
  });

  revalidatePath("/app/admin/kiosks");
  redirect(`/app/admin/kiosks?paired=${deviceId}`);
}
