"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLocations, scManagerLocations } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAdmin as isOwnerLevel } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// Only owners can grant/revoke manager scopes — keeping a scoped
// admin from elevating their own scope.
async function requireOwner() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isOwnerLevel(m.role)) {
    throw new Error("Only the owner can edit manager scopes.");
  }
  return m;
}

const grantSchema = z.object({
  appUserId: z.string().uuid(),
  locationId: z.string().uuid(),
});

export async function grantScopeAction(formData: FormData): Promise<void> {
  const parsed = grantSchema.safeParse({
    appUserId: formData.get("appUserId"),
    locationId: formData.get("locationId"),
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const me = await requireUser();
  const tenantId = membership.tenant.id;

  // Confirm the location belongs to this tenant before granting. RLS
  // would block a cross-tenant insert anyway, but a friendlier no-op
  // here keeps the audit log clean.
  const [loc] = await forTenant(tenantId).run((tx) =>
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
  if (!loc) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scManagerLocations)
      .values({
        traceyTenantId: tenantId,
        appUserId: parsed.data.appUserId,
        locationId: parsed.data.locationId,
        grantedByUserId: me.id,
      })
      .onConflictDoNothing(),
  );

  await logAuditEvent({
    action: "shiftcraft.manager_scope.granted",
    targetKind: "sc_manager_location",
    details: parsed.data,
  });
  revalidatePath("/app/admin/manager-scopes");
  revalidatePath("/app/schedule");
}

export async function revokeScopeAction(formData: FormData): Promise<void> {
  const parsed = grantSchema.safeParse({
    appUserId: formData.get("appUserId"),
    locationId: formData.get("locationId"),
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scManagerLocations)
      .where(
        and(
          eq(scManagerLocations.traceyTenantId, tenantId),
          eq(scManagerLocations.appUserId, parsed.data.appUserId),
          eq(scManagerLocations.locationId, parsed.data.locationId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.manager_scope.revoked",
    targetKind: "sc_manager_location",
    details: parsed.data,
  });
  revalidatePath("/app/admin/manager-scopes");
  revalidatePath("/app/schedule");
}

// "Grant all" shortcut: deletes every row for this user, which flips
// them back to the backwards-compat unscoped state (full access).
export async function clearScopeAction(formData: FormData): Promise<void> {
  const userId = String(formData.get("appUserId") ?? "");
  if (!userId) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;
  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scManagerLocations)
      .where(
        and(
          eq(scManagerLocations.traceyTenantId, tenantId),
          eq(scManagerLocations.appUserId, userId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.manager_scope.cleared",
    targetKind: "sc_manager_location",
    details: { appUserId: userId },
  });
  revalidatePath("/app/admin/manager-scopes");
  revalidatePath("/app/schedule");
}
