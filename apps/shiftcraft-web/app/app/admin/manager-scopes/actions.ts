"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scAreas,
  scLeadAreas,
  scLocations,
  scManagerLocations,
} from "@tracey/db";
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

// ─── Lead area scopes (Access levels — "Lead" tier) ─────────────────
//
// Same owner-only model as the location scopes above, but grants a Lead one
// or more areas (sc_areas). A Lead with no areas sees nothing (fail-closed).

const grantAreaSchema = z.object({
  appUserId: z.string().uuid(),
  areaId: z.string().uuid(),
});

export async function grantLeadAreaAction(formData: FormData): Promise<void> {
  const parsed = grantAreaSchema.safeParse({
    appUserId: formData.get("appUserId"),
    areaId: formData.get("areaId"),
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const me = await requireUser();
  const tenantId = membership.tenant.id;

  // Confirm the area belongs to this tenant before granting.
  const [area] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ id: scAreas.id })
      .from(scAreas)
      .where(
        and(
          eq(scAreas.id, parsed.data.areaId),
          eq(scAreas.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!area) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scLeadAreas)
      .values({
        traceyTenantId: tenantId,
        appUserId: parsed.data.appUserId,
        areaId: parsed.data.areaId,
        grantedByUserId: me.id,
      })
      .onConflictDoNothing(),
  );

  await logAuditEvent({
    action: "shiftcraft.lead_scope.granted",
    targetKind: "sc_lead_area",
    details: parsed.data,
  });
  revalidatePath("/app/admin/manager-scopes");
  revalidatePath("/app/timesheets");
  revalidatePath("/app/schedule");
}

export async function revokeLeadAreaAction(formData: FormData): Promise<void> {
  const parsed = grantAreaSchema.safeParse({
    appUserId: formData.get("appUserId"),
    areaId: formData.get("areaId"),
  });
  if (!parsed.success) return;
  const membership = await requireOwner();
  const tenantId = membership.tenant.id;

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scLeadAreas)
      .where(
        and(
          eq(scLeadAreas.traceyTenantId, tenantId),
          eq(scLeadAreas.appUserId, parsed.data.appUserId),
          eq(scLeadAreas.areaId, parsed.data.areaId),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.lead_scope.revoked",
    targetKind: "sc_lead_area",
    details: parsed.data,
  });
  revalidatePath("/app/admin/manager-scopes");
  revalidatePath("/app/timesheets");
  revalidatePath("/app/schedule");
}
