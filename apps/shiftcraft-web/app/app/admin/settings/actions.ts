"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scTenantConfig, type ScHolidayRegion } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { HOLIDAY_REGIONS } from "~/lib/holidays";

const regionSchema = z.object({
  region: z.enum(HOLIDAY_REGIONS),
});

export type SettingsFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function setHolidayRegionAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can change workspace settings.",
    };
  }
  const tenantId = membership.tenant.id;

  const parsed = regionSchema.safeParse({ region: formData.get("region") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Pick a valid region.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const newRegion = parsed.data.region as ScHolidayRegion;

  // Pull the previous value so the audit row has a meaningful before/after.
  // Returns undefined when no config row exists yet — first save creates it.
  const [prev] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ region: scTenantConfig.holidayRegion })
      .from(scTenantConfig)
      .where(eq(scTenantConfig.traceyTenantId, tenantId))
      .limit(1),
  );
  const previousRegion = (prev?.region as ScHolidayRegion | undefined) ?? "national";

  // No-op shortcut: same region selected. Don't write an audit event for
  // a non-change — the timeline stays signal-rich.
  if (previousRegion === newRegion && prev) {
    return { status: "ok", message: "Holiday region unchanged." };
  }

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({
        traceyTenantId: tenantId,
        holidayRegion: newRegion,
        updatedByUserId: me.id,
      })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: {
          holidayRegion: newRegion,
          updatedByUserId: me.id,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.tenant.holiday_region_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: { from: previousRegion, to: newRegion },
  });

  revalidatePath("/app/admin/settings");
  return { status: "ok", message: "Holiday region saved." };
}
