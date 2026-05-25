"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scDailySales } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireManager() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers and admins can edit daily sales.");
  }
  return m;
}

const upsertSchema = z.object({
  locationId: z.string().uuid("Pick a location"),
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  // Accept the raw string from the form; coerce + range-check below so
  // the error message is friendlier than Zod's generic "expected number".
  grossSales: z.string().trim(),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function upsertDailySaleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = upsertSchema.safeParse({
    locationId: formData.get("locationId"),
    businessDate: formData.get("businessDate"),
    grossSales: formData.get("grossSales") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // Hand-parse the money input so we accept "$1,234.50" / "1234" / "0".
  // The numeric() DB column constrains precision; here we only enforce
  // the sign + finite checks.
  const cleaned = parsed.data.grossSales.replace(/[\s$,]/g, "");
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      status: "error",
      message: "Enter a non-negative amount.",
      fieldErrors: { grossSales: ["Enter a non-negative amount"] },
    };
  }
  if (amount > 9_999_999_999.99) {
    return {
      status: "error",
      message: "Amount is unreasonably large.",
      fieldErrors: { grossSales: ["Amount is unreasonably large"] },
    };
  }

  const membership = await requireManager();
  const user = await requireUser();
  const tenantId = membership.tenant.id;
  const grossSalesStr = amount.toFixed(2);
  const notes = parsed.data.notes?.length ? parsed.data.notes : null;

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scDailySales)
      .values({
        traceyTenantId: tenantId,
        locationId: parsed.data.locationId,
        businessDate: parsed.data.businessDate,
        grossSales: grossSalesStr,
        notes,
        createdByUserId: user.id,
        updatedByUserId: user.id,
      })
      .onConflictDoUpdate({
        target: [
          scDailySales.traceyTenantId,
          scDailySales.locationId,
          scDailySales.businessDate,
        ],
        set: {
          grossSales: grossSalesStr,
          notes,
          updatedByUserId: user.id,
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.daily_sales.upserted",
    targetKind: "sc_daily_sales",
    details: {
      locationId: parsed.data.locationId,
      businessDate: parsed.data.businessDate,
      grossSales: grossSalesStr,
    },
  });

  revalidatePath("/app/admin/daily-sales");
  revalidatePath("/app/reports");
  return { status: "ok", message: "Saved." };
}

const deleteSchema = z.object({
  locationId: z.string().uuid(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function deleteDailySaleAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse({
    locationId: formData.get("locationId"),
    businessDate: formData.get("businessDate"),
  });
  if (!parsed.success) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scDailySales)
      .where(
        and(
          eq(scDailySales.traceyTenantId, membership.tenant.id),
          eq(scDailySales.locationId, parsed.data.locationId),
          eq(scDailySales.businessDate, parsed.data.businessDate),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.daily_sales.deleted",
    targetKind: "sc_daily_sales",
    details: parsed.data,
  });
  revalidatePath("/app/admin/daily-sales");
  revalidatePath("/app/reports");
}
