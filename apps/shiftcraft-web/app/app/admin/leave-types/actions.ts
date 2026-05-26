"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLeaveTypes } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import {
  deriveSlugFromName,
  isLeaveTypeInUse,
} from "~/lib/leave-types";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireManager() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers and admins can edit leave types.");
  }
  return m;
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
});

export async function createLeaveTypeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireManager();
  const slug = deriveSlugFromName(parsed.data.name);

  try {
    await forTenant(membership.tenant.id).run((tx) =>
      tx.insert(scLeaveTypes).values({
        traceyTenantId: membership.tenant.id,
        name: parsed.data.name,
        slug,
        sortOrder: 50,
      }),
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("sc_leave_types_tenant_name_uq")) {
        return {
          status: "error",
          message: "A leave type with that name already exists.",
          fieldErrors: { name: ["Pick a different name"] },
        };
      }
      if (err.message.includes("sc_leave_types_tenant_slug_uq")) {
        return {
          status: "error",
          message: "Generated slug collides with an existing type — pick a slightly different name.",
          fieldErrors: { name: ["Pick a different name"] },
        };
      }
    }
    throw err;
  }

  await logAuditEvent({
    action: "shiftcraft.leave_type.created",
    targetKind: "sc_leave_type",
    details: { name: parsed.data.name, slug },
  });

  revalidatePath("/app/admin/leave-types");
  revalidatePath("/app/time-off");
  return { status: "ok", message: "Added." };
}

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(80),
});

export async function renameLeaveTypeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = renameSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireManager();
  try {
    await forTenant(membership.tenant.id).run((tx) =>
      tx
        .update(scLeaveTypes)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(
          and(
            eq(scLeaveTypes.id, parsed.data.id),
            eq(scLeaveTypes.traceyTenantId, membership.tenant.id),
          ),
        ),
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("sc_leave_types_tenant_name_uq")
    ) {
      return {
        status: "error",
        message: "Another leave type already has that name.",
        fieldErrors: { name: ["Pick a different name"] },
      };
    }
    throw err;
  }

  await logAuditEvent({
    action: "shiftcraft.leave_type.renamed",
    targetKind: "sc_leave_type",
    targetId: parsed.data.id,
    details: { name: parsed.data.name },
  });

  revalidatePath("/app/admin/leave-types");
  revalidatePath("/app/time-off");
  return { status: "ok", message: "Renamed." };
}

// ─── Accrual rate (AUDIT.md Feature 6) ──────────────────────────────
//
// Accepts an "hours per hour" decimal (4 weeks/year ≈ 0.076923 for
// AU full-time annual leave). Empty input clears the rate to null
// (= no accrual). Validation: 0 ≤ rate ≤ 1 — a rate above 1.0 would
// mean accruing more than an hour of leave per hour worked, which
// is never right.

const accrualSchema = z.object({
  id: z.string().uuid(),
  rate: z.string().trim(),
});

export async function setAccrualRateAction(
  formData: FormData,
): Promise<void> {
  const parsed = accrualSchema.safeParse({
    id: formData.get("id"),
    rate: formData.get("rate") ?? "",
  });
  if (!parsed.success) return;
  const membership = await requireManager();

  // Empty rate clears to null.
  let rateValue: string | null = null;
  if (parsed.data.rate !== "") {
    const n = Number(parsed.data.rate);
    if (!Number.isFinite(n) || n < 0 || n > 1) return;
    rateValue = n.toFixed(6);
  }

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scLeaveTypes)
      .set({ accrualRatePerHour: rateValue, updatedAt: new Date() })
      .where(
        and(
          eq(scLeaveTypes.id, parsed.data.id),
          eq(scLeaveTypes.traceyTenantId, membership.tenant.id),
        ),
      ),
  );

  await logAuditEvent({
    action: "shiftcraft.leave_type.accrual_set",
    targetKind: "sc_leave_type",
    targetId: parsed.data.id,
    details: { rate: rateValue },
  });

  revalidatePath("/app/admin/leave-types");
  revalidatePath("/app/time-off");
}

export async function toggleArchiveAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  if (!id) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scLeaveTypes)
      .set({ isArchived: archive, updatedAt: new Date() })
      .where(
        and(
          eq(scLeaveTypes.id, id),
          eq(scLeaveTypes.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: archive
      ? "shiftcraft.leave_type.archived"
      : "shiftcraft.leave_type.unarchived",
    targetKind: "sc_leave_type",
    targetId: id,
  });
  revalidatePath("/app/admin/leave-types");
  revalidatePath("/app/time-off");
}

export async function deleteLeaveTypeAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireManager();
  // Application-side guard: the ON DELETE RESTRICT FK on
  // sc_time_off_requests would already block this, but checking up front
  // lets us return a friendlier message (the action redirects with a
  // ?error= param the page picks up).
  if (await isLeaveTypeInUse(membership.tenant.id, id)) {
    revalidatePath("/app/admin/leave-types");
    return;
  }
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scLeaveTypes)
      .where(
        and(
          eq(scLeaveTypes.id, id),
          eq(scLeaveTypes.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.leave_type.deleted",
    targetKind: "sc_leave_type",
    targetId: id,
  });
  revalidatePath("/app/admin/leave-types");
}
