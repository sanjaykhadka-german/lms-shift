"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scAreas,
  scAreaSkills,
  scShifts,
  scShiftTemplates,
} from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const createSchema = z.object({
  locationId: z.string().uuid("Pick a location"),
  name: z.string().trim().min(1, "Name is required").max(80, "Too long"),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour")
    .optional()
    .or(z.literal("")),
});
// Edit keeps the location fixed (the rename-cascade below depends on it), so
// the edit form only sends name + colour.
const editSchema = createSchema.omit({ locationId: true });

function emptyToNull(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function requireManagerTenant() {
  const m = await currentMembership();
  if (!m) return { ok: false as const, message: "No workspace selected." };
  if (!isAtLeastManager(m.role)) {
    return { ok: false as const, message: "Only managers can manage areas." };
  }
  return { ok: true as const, tenantId: m.tenant.id };
}

export async function createAreaAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await requireManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = createSchema.safeParse({
    locationId: formData.get("locationId"),
    name: formData.get("name"),
    color: formData.get("color") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Case-insensitive uniqueness within the location (matches the unique index).
  const existing = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scAreas.id })
      .from(scAreas)
      .where(
        and(
          eq(scAreas.traceyTenantId, g.tenantId),
          eq(scAreas.locationId, parsed.data.locationId),
          sql`lower(${scAreas.name}) = lower(${parsed.data.name})`,
        ),
      )
      .limit(1),
  );
  if (existing.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["An area with this name already exists at this location."] },
    };
  }

  await forTenant(g.tenantId).run((tx) =>
    tx.insert(scAreas).values({
      traceyTenantId: g.tenantId,
      locationId: parsed.data.locationId,
      name: parsed.data.name,
      color: emptyToNull(parsed.data.color),
    }),
  );
  await logAuditEvent({
    action: "shiftcraft.area.created",
    targetKind: "sc_area",
    details: { name: parsed.data.name, locationId: parsed.data.locationId },
  });
  revalidatePath("/app/areas");
  revalidatePath("/app/schedule");
  redirect("/app/areas?added=1");
}

export async function updateAreaAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await requireManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const parsed = editSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const [current] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ name: scAreas.name, locationId: scAreas.locationId })
      .from(scAreas)
      .where(
        and(eq(scAreas.id, id), eq(scAreas.traceyTenantId, g.tenantId)),
      )
      .limit(1),
  );
  if (!current) return { status: "error", message: "Area not found." };

  // Uniqueness within the location, excluding this row.
  const dup = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scAreas.id })
      .from(scAreas)
      .where(
        and(
          eq(scAreas.traceyTenantId, g.tenantId),
          eq(scAreas.locationId, current.locationId),
          sql`lower(${scAreas.name}) = lower(${parsed.data.name})`,
          sql`${scAreas.id} <> ${id}`,
        ),
      )
      .limit(1),
  );
  if (dup.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["Another area at this location uses this name."] },
    };
  }

  const renamed = current.name !== parsed.data.name;

  await forTenant(g.tenantId).run(async (tx) => {
    await tx
      .update(scAreas)
      .set({ name: parsed.data.name, color: emptyToNull(parsed.data.color) })
      .where(
        and(eq(scAreas.id, id), eq(scAreas.traceyTenantId, g.tenantId)),
      );

    // Rename-cascade: shifts + templates store the area name in `role`, so a
    // rename must follow them (within this area's location) or the schedule
    // grid would split into stale + new rows. This reproduces Deputy's
    // rename-propagation without an area_id FK on every shift.
    if (renamed) {
      await tx
        .update(scShifts)
        .set({ role: parsed.data.name })
        .where(
          and(
            eq(scShifts.traceyTenantId, g.tenantId),
            eq(scShifts.locationId, current.locationId),
            eq(scShifts.role, current.name),
          ),
        );
      await tx
        .update(scShiftTemplates)
        .set({ role: parsed.data.name })
        .where(
          and(
            eq(scShiftTemplates.traceyTenantId, g.tenantId),
            eq(scShiftTemplates.locationId, current.locationId),
            eq(scShiftTemplates.role, current.name),
          ),
        );
    }
  });

  await logAuditEvent({
    action: "shiftcraft.area.updated",
    targetKind: "sc_area",
    targetId: id,
    details: {
      name: parsed.data.name,
      renamedFrom: renamed ? current.name : null,
      locationId: current.locationId,
    },
  });
  revalidatePath("/app/areas");
  revalidatePath(`/app/areas/${id}/edit`);
  revalidatePath("/app/schedule");
  return { status: "ok", message: "Saved." };
}

// Replace the set of skills required to work in an area (items 4 & 7). Used by
// the per-area "Required skills" picker on the edit page. Delete-then-insert is
// fine here — the set is tiny and the unique index would otherwise need an
// upsert dance. Empty selection clears all requirements.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setAreaSkillsAction(
  areaId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const g = await requireManagerTenant();
  if (!g.ok) return { status: "error", message: g.message };

  const [area] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ id: scAreas.id })
      .from(scAreas)
      .where(and(eq(scAreas.id, areaId), eq(scAreas.traceyTenantId, g.tenantId)))
      .limit(1),
  );
  if (!area) return { status: "error", message: "Area not found." };

  const skillIds = Array.from(
    new Set(
      formData
        .getAll("skillIds")
        .map(String)
        .filter((v) => UUID_RE.test(v)),
    ),
  );

  await forTenant(g.tenantId).run(async (tx) => {
    await tx
      .delete(scAreaSkills)
      .where(
        and(
          eq(scAreaSkills.traceyTenantId, g.tenantId),
          eq(scAreaSkills.areaId, areaId),
        ),
      );
    if (skillIds.length > 0) {
      await tx.insert(scAreaSkills).values(
        skillIds.map((skillId) => ({
          traceyTenantId: g.tenantId,
          areaId,
          skillId,
        })),
      );
    }
  });

  await logAuditEvent({
    action: "shiftcraft.area.skills_set",
    targetKind: "sc_area",
    targetId: areaId,
    details: { count: skillIds.length },
  });
  revalidatePath(`/app/areas/${areaId}/edit`);
  revalidatePath("/app/schedule");
  return { status: "ok", message: "Required skills saved." };
}

// Delete an area (removes it from the managed vocabulary). Existing shifts keep
// their `role` text — there's no FK on sc_shifts — so no schedule data is lost;
// the role just stops being offered as a pre-defined pick.
export async function deleteAreaAction(formData: FormData): Promise<void> {
  const g = await requireManagerTenant();
  if (!g.ok) {
    console.warn("[deleteAreaAction] refused:", g.message);
    return;
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const [doomed] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ name: scAreas.name, locationId: scAreas.locationId })
      .from(scAreas)
      .where(and(eq(scAreas.id, id), eq(scAreas.traceyTenantId, g.tenantId)))
      .limit(1),
  );

  await forTenant(g.tenantId).run((tx) =>
    tx
      .delete(scAreas)
      .where(and(eq(scAreas.id, id), eq(scAreas.traceyTenantId, g.tenantId))),
  );
  await logAuditEvent({
    action: "shiftcraft.area.deleted",
    targetKind: "sc_area",
    targetId: id,
    details: doomed ? { name: doomed.name, locationId: doomed.locationId } : null,
  });

  revalidatePath("/app/areas");
  revalidatePath("/app/schedule");
  redirect("/app/areas");
}
