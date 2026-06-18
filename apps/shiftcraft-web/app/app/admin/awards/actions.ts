"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scAwardClassifications,
  scEmployees,
  scTenantConfig,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isWorkspaceAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireAdmin() {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isWorkspaceAdmin(membership.role)) {
    return null;
  }
  return { me, tenantId: membership.tenant.id };
}

const DENIED: FormState = {
  status: "error",
  message: "Only Managers and Admins can manage award classifications.",
};

const classificationSchema = z.object({
  awardCode: z.string().min(2),
  levelCode: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  baseHourlyRate: z.number().positive(),
  casualLoading: z.number().min(0).max(2).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function num(raw: FormDataEntryValue | null): number | undefined {
  if (raw == null) return undefined;
  const cleaned = String(raw).replace(/[\s,$]/g, "");
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// Create or update a classification. Upsert keyed on
// (tenant, award, level, effective_from) — re-saving the same level + date
// edits the label/rate, so this doubles as the edit path.
export async function saveClassificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;

  const parsed = classificationSchema.safeParse({
    awardCode: formData.get("awardCode"),
    levelCode: String(formData.get("levelCode") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    baseHourlyRate: num(formData.get("baseHourlyRate")),
    casualLoading: num(formData.get("casualLoading")),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scAwardClassifications)
      .values({
        traceyTenantId: tenantId,
        awardCode: d.awardCode,
        levelCode: d.levelCode,
        label: d.label,
        baseHourlyRate: d.baseHourlyRate.toFixed(2),
        casualLoading:
          d.casualLoading != null ? d.casualLoading.toFixed(4) : null,
        effectiveFrom: d.effectiveFrom,
        source: "manual",
      })
      .onConflictDoUpdate({
        target: [
          scAwardClassifications.traceyTenantId,
          scAwardClassifications.awardCode,
          scAwardClassifications.levelCode,
          scAwardClassifications.effectiveFrom,
        ],
        set: {
          label: d.label,
          baseHourlyRate: d.baseHourlyRate.toFixed(2),
          casualLoading:
            d.casualLoading != null ? d.casualLoading.toFixed(4) : null,
          source: "manual",
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.award.classification_saved",
    targetKind: "tenant",
    targetId: tenantId,
    details: {
      awardCode: d.awardCode,
      levelCode: d.levelCode,
      effectiveFrom: d.effectiveFrom,
    },
  });

  revalidatePath("/app/admin/awards");
  return { status: "ok", message: `Saved classification ${d.levelCode}.` };
}

export async function deleteClassificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Missing classification id." };

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scAwardClassifications)
      .where(
        and(
          eq(scAwardClassifications.traceyTenantId, tenantId),
          eq(scAwardClassifications.id, id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.award.classification_deleted",
    targetKind: "tenant",
    targetId: tenantId,
    details: { id },
  });
  revalidatePath("/app/admin/awards");
  return { status: "ok", message: "Classification removed." };
}

export async function assignEmployeeLevelAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;
  const employeeId = String(formData.get("employeeId") ?? "");
  const levelCodeRaw = String(formData.get("levelCode") ?? "").trim();
  const levelCode = levelCodeRaw === "" ? null : levelCodeRaw;
  if (!employeeId) return { status: "error", message: "Missing employee." };

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({ awardLevelCode: levelCode, updatedAt: new Date() })
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          eq(scEmployees.id, employeeId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.award.employee_level_assigned",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: { levelCode },
  });
  revalidatePath("/app/admin/awards");
  return { status: "ok", message: "Classification assigned." };
}

export async function setFloorBlockAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { me, tenantId } = auth;
  const block = formData.get("block") === "on";

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scTenantConfig)
      .values({
        traceyTenantId: tenantId,
        awardFloorBlock: block,
        updatedByUserId: me.id,
      })
      .onConflictDoUpdate({
        target: scTenantConfig.traceyTenantId,
        set: {
          awardFloorBlock: block,
          updatedByUserId: me.id,
          updatedAt: new Date(),
        },
      }),
  );
  await logAuditEvent({
    action: "shiftcraft.award.floor_enforcement_changed",
    targetKind: "tenant",
    targetId: tenantId,
    details: { block },
  });
  revalidatePath("/app/admin/awards");
  return {
    status: "ok",
    message: block
      ? "Under-minimum rates will now block."
      : "Under-minimum rates will warn only.",
  };
}
