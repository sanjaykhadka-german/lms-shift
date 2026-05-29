"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLocations } from "@tracey/db";
import { requireMembership } from "~/lib/auth/current";

export type LocationFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  timezone: z.string().trim().min(1, "Timezone is required").max(64),
  address: z.string().trim().max(300).optional(),
});

// Only owners/admins may manage locations; members can view.
function canManage(role: string): boolean {
  return role === "owner" || role === "admin";
}

export async function createLocationAction(
  _prev: LocationFormState,
  formData: FormData,
): Promise<LocationFormState> {
  const { tenant, role } = await requireMembership();
  if (!canManage(role)) {
    return { status: "error", message: "Only owners and admins can add locations." };
  }

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    address: formData.get("address") || undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { name, timezone, address } = parsed.data;

  await forTenant(tenant.id).run((tx) =>
    tx.insert(scLocations).values({
      traceyTenantId: tenant.id,
      name,
      timezone,
      address: address ?? null,
    }),
  );

  revalidatePath("/app/locations");
  return { status: "ok", message: `Added ${name}.` };
}

export async function deleteLocationAction(formData: FormData): Promise<void> {
  const { tenant, role } = await requireMembership();
  if (!canManage(role)) return;

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  // RLS + the explicit tenant filter both scope this to the caller's tenant.
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scLocations)
      .where(and(eq(scLocations.id, id), eq(scLocations.traceyTenantId, tenant.id))),
  );

  revalidatePath("/app/locations");
}
