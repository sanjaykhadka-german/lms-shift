"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scAwardAllowances,
  scAwardClassifications,
  scEmployeeAllowances,
  scEmployees,
  scTenantConfig,
} from "@tracey/db";
import { transformFwcPayload } from "@tracey/award";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isWorkspaceAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { fmtIsoDate } from "~/lib/clock";
import { getTenantAwardMeta } from "~/lib/award-profile";
import {
  listClassifications,
  resolveCurrent,
} from "~/lib/award-classifications";
import { listAllowances } from "~/lib/award-allowances";
import {
  fetchAwardPayload,
  isFairWorkConfigured,
} from "~/lib/award/fairwork/client";

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

// ─── Allowances (Slice C) ─────────────────────────────────────────────

const allowanceSchema = z.object({
  awardCode: z.string().min(2),
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "Lowercase letters, digits, underscores."),
  label: z.string().min(1).max(120),
  type: z.enum(["flat", "per_hour", "per_shift", "per_day"]),
  amount: z.number().positive(),
  taxable: z.boolean().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function saveAllowanceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;

  const parsed = allowanceSchema.safeParse({
    awardCode: formData.get("awardCode"),
    key: String(formData.get("key") ?? "").trim(),
    label: String(formData.get("label") ?? "").trim(),
    type: formData.get("type"),
    amount: num(formData.get("amount")),
    taxable: formData.get("taxable") === "on",
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
      .insert(scAwardAllowances)
      .values({
        traceyTenantId: tenantId,
        awardCode: d.awardCode,
        key: d.key,
        label: d.label,
        type: d.type,
        amount: d.amount.toFixed(4),
        taxable: d.taxable ?? true,
        effectiveFrom: d.effectiveFrom,
        source: "manual",
      })
      .onConflictDoUpdate({
        target: [
          scAwardAllowances.traceyTenantId,
          scAwardAllowances.awardCode,
          scAwardAllowances.key,
          scAwardAllowances.effectiveFrom,
        ],
        set: {
          label: d.label,
          type: d.type,
          amount: d.amount.toFixed(4),
          taxable: d.taxable ?? true,
          source: "manual",
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.award.allowance_saved",
    targetKind: "tenant",
    targetId: tenantId,
    details: { awardCode: d.awardCode, key: d.key, type: d.type },
  });
  revalidatePath("/app/admin/awards");
  return { status: "ok", message: `Saved allowance ${d.key}.` };
}

export async function deleteAllowanceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;
  const id = String(formData.get("id") ?? "");
  if (!id) return { status: "error", message: "Missing allowance id." };

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scAwardAllowances)
      .where(
        and(
          eq(scAwardAllowances.traceyTenantId, tenantId),
          eq(scAwardAllowances.id, id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.award.allowance_deleted",
    targetKind: "tenant",
    targetId: tenantId,
    details: { id },
  });
  revalidatePath("/app/admin/awards");
  return { status: "ok", message: "Allowance removed." };
}

// Replace the full set of allowances assigned to one employee.
export async function setEmployeeAllowancesAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const auth = await requireAdmin();
  if (!auth) return DENIED;
  const { tenantId } = auth;
  const employeeId = String(formData.get("employeeId") ?? "");
  if (!employeeId) return { status: "error", message: "Missing employee." };
  const allowanceIds = formData
    .getAll("allowanceId")
    .map((v) => String(v))
    .filter(Boolean);

  await forTenant(tenantId).run(async (tx) => {
    await tx
      .delete(scEmployeeAllowances)
      .where(
        and(
          eq(scEmployeeAllowances.traceyTenantId, tenantId),
          eq(scEmployeeAllowances.employeeId, employeeId),
        ),
      );
    if (allowanceIds.length > 0) {
      await tx.insert(scEmployeeAllowances).values(
        allowanceIds.map((allowanceId) => ({
          traceyTenantId: tenantId,
          employeeId,
          allowanceId,
        })),
      );
    }
  });

  await logAuditEvent({
    action: "shiftcraft.award.employee_allowances_set",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: { count: allowanceIds.length },
  });
  revalidatePath("/app/admin/awards");
  return { status: "ok", message: "Allowances updated." };
}

// ─── Fair Work MAPD fetch + apply (Slice D) ───────────────────────────

export interface FairWorkPreviewItem {
  kind: "classification" | "allowance";
  code: string;
  label: string;
  detail: string;
  status: "new" | "changed" | "same";
}

export type FairWorkState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string }
  | {
      status: "preview";
      message: string;
      effectiveFrom: string;
      items: FairWorkPreviewItem[];
    };

type LoadFairWork =
  | { ok: false; error: string }
  | {
      ok: true;
      transformed: ReturnType<typeof transformFwcPayload>;
      awardCode: string;
    };

async function loadFairWork(tenantId: string): Promise<LoadFairWork> {
  const meta = await getTenantAwardMeta(tenantId);
  if (!meta.awardCode) {
    return { ok: false, error: "Pick an award in Workspace settings first." };
  }
  if (!isFairWorkConfigured()) {
    return {
      ok: false,
      error:
        "Fair Work isn't configured. Set FWC_MAPD_API_KEY in the environment first.",
    };
  }
  const asOf = fmtIsoDate(new Date());
  const payload = await fetchAwardPayload(meta.awardCode, asOf);
  if (!payload) {
    return { ok: false, error: "Fair Work returned no data for this award." };
  }
  return {
    ok: true,
    transformed: transformFwcPayload(payload, asOf),
    awardCode: meta.awardCode,
  };
}

// Fetch from Fair Work and diff against the current rows — does NOT write.
export async function previewFairWorkAction(
  _prev: FairWorkState,
  _formData: FormData,
): Promise<FairWorkState> {
  const auth = await requireAdmin();
  if (!auth)
    return {
      status: "error",
      message: "Only Managers and Admins can manage award classifications.",
    };
  const { tenantId } = auth;

  let loaded: LoadFairWork;
  try {
    loaded = await loadFairWork(tenantId);
  } catch (err) {
    return {
      status: "error",
      message: `Fair Work fetch failed: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
  if (!loaded.ok) return { status: "error", message: loaded.error };
  const { transformed } = loaded;
  const asOf = fmtIsoDate(new Date());

  const [clsRows, allowRows] = await Promise.all([
    listClassifications(tenantId, transformed.awardCode),
    listAllowances(tenantId, transformed.awardCode),
  ]);
  const currentCls = resolveCurrent(clsRows, asOf);
  const currentAllowByKey = new Map<string, (typeof allowRows)[number]>();
  for (const a of allowRows) {
    if (a.effectiveFrom > asOf) continue;
    const ex = currentAllowByKey.get(a.key);
    if (!ex || a.effectiveFrom > ex.effectiveFrom) currentAllowByKey.set(a.key, a);
  }

  const items: FairWorkPreviewItem[] = [];
  for (const c of transformed.classifications) {
    const ex = currentCls.get(c.levelCode);
    const status = !ex
      ? "new"
      : ex.baseHourlyRate !== c.baseHourlyRate
        ? "changed"
        : "same";
    items.push({
      kind: "classification",
      code: c.levelCode,
      label: c.label,
      detail: `$${c.baseHourlyRate.toFixed(2)}/h${ex && status === "changed" ? ` (was $${ex.baseHourlyRate.toFixed(2)})` : ""}`,
      status,
    });
  }
  for (const a of transformed.allowances) {
    const ex = currentAllowByKey.get(a.key);
    const status = !ex
      ? "new"
      : ex.amount !== a.amount || ex.type !== a.type
        ? "changed"
        : "same";
    items.push({
      kind: "allowance",
      code: a.key,
      label: a.label,
      detail: `$${a.amount.toFixed(2)} ${a.type}`,
      status,
    });
  }

  const changed = items.filter((i) => i.status !== "same").length;
  return {
    status: "preview",
    message:
      changed === 0
        ? "Already up to date with Fair Work."
        : `${changed} change(s) from Fair Work. Review then Apply.`,
    effectiveFrom: transformed.effectiveFrom,
    items,
  };
}

// Re-fetch and apply: upsert classifications + allowances (source='fwc') and
// stamp the award effective date. Re-fetches rather than trusting the preview.
export async function applyFairWorkAction(
  _prev: FairWorkState,
  _formData: FormData,
): Promise<FairWorkState> {
  const auth = await requireAdmin();
  if (!auth)
    return {
      status: "error",
      message: "Only Managers and Admins can manage award classifications.",
    };
  const { me, tenantId } = auth;

  let loaded: LoadFairWork;
  try {
    loaded = await loadFairWork(tenantId);
  } catch (err) {
    return {
      status: "error",
      message: `Fair Work fetch failed: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
  if (!loaded.ok) return { status: "error", message: loaded.error };
  const { transformed, awardCode } = loaded;

  await forTenant(tenantId).run(async (tx) => {
    for (const c of transformed.classifications) {
      await tx
        .insert(scAwardClassifications)
        .values({
          traceyTenantId: tenantId,
          awardCode,
          levelCode: c.levelCode,
          label: c.label,
          baseHourlyRate: c.baseHourlyRate.toFixed(2),
          effectiveFrom: c.effectiveFrom,
          source: "fwc",
        })
        .onConflictDoUpdate({
          target: [
            scAwardClassifications.traceyTenantId,
            scAwardClassifications.awardCode,
            scAwardClassifications.levelCode,
            scAwardClassifications.effectiveFrom,
          ],
          set: {
            label: c.label,
            baseHourlyRate: c.baseHourlyRate.toFixed(2),
            source: "fwc",
            updatedAt: new Date(),
          },
        });
    }
    for (const a of transformed.allowances) {
      await tx
        .insert(scAwardAllowances)
        .values({
          traceyTenantId: tenantId,
          awardCode,
          key: a.key,
          label: a.label,
          type: a.type,
          amount: a.amount.toFixed(4),
          taxable: a.taxable,
          effectiveFrom: a.effectiveFrom,
          source: "fwc",
        })
        .onConflictDoUpdate({
          target: [
            scAwardAllowances.traceyTenantId,
            scAwardAllowances.awardCode,
            scAwardAllowances.key,
            scAwardAllowances.effectiveFrom,
          ],
          set: {
            label: a.label,
            type: a.type,
            amount: a.amount.toFixed(4),
            taxable: a.taxable,
            source: "fwc",
            updatedAt: new Date(),
          },
        });
    }
    await tx
      .update(scTenantConfig)
      .set({
        awardEffectiveFrom: transformed.effectiveFrom,
        updatedByUserId: me.id,
        updatedAt: new Date(),
      })
      .where(eq(scTenantConfig.traceyTenantId, tenantId));
  });

  await logAuditEvent({
    action: "shiftcraft.award.fairwork_imported",
    targetKind: "tenant",
    targetId: tenantId,
    details: {
      awardCode,
      effectiveFrom: transformed.effectiveFrom,
      fetchedAt: new Date().toISOString(),
      classifications: transformed.classifications.length,
      allowances: transformed.allowances.length,
      source: "fwc",
    },
  });

  revalidatePath("/app/admin/awards");
  return {
    status: "ok",
    message: `Imported ${transformed.classifications.length} classification(s) + ${transformed.allowances.length} allowance(s) from Fair Work (effective ${transformed.effectiveFrom}). Verify a couple against the Fair Work Pay Guide.`,
  };
}
