"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { forTenant, scVisitorSignins } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manager-driven sign-out, e.g. a visitor who left without signing out at the
// kiosk. Stamps signed_out_at without a signature. Tenant-scoped and guarded
// to still-open visits.
export async function adminSignOutVisitorAction(
  formData: FormData,
): Promise<void> {
  const membership = await currentMembership();
  if (!membership || !isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;

  const id = String(formData.get("id") ?? "").trim();
  if (!UUID_RE.test(id)) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scVisitorSignins)
      .set({ signedOutAt: new Date() })
      .where(
        and(
          eq(scVisitorSignins.id, id),
          eq(scVisitorSignins.traceyTenantId, tenantId),
          isNull(scVisitorSignins.signedOutAt),
        ),
      ),
  );

  revalidatePath("/app/admin/visitors");
}
