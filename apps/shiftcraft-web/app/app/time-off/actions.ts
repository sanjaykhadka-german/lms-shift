"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scLeaveTypes, scTimeOffRequests } from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

const submitSchema = z
  .object({
    leaveTypeId: z.string().uuid("Choose a leave type"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    reason: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ["endDate"],
    message: "End must be on or after start",
  });

async function requireAdminMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (m.role !== "admin" && m.role !== "owner") {
    throw new Error("Only admins can review time-off requests.");
  }
  return m;
}

async function requireAnyMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  return m;
}

export async function submitTimeOffAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = submitSchema.safeParse({
    leaveTypeId: formData.get("leaveTypeId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireAnyMembership();
  const user = await requireUser();

  // Cross-tenant guard: leaveTypeId must belong to this tenant AND not
  // be archived. Validating here (rather than relying solely on the FK)
  // gives a friendlier error than a Postgres constraint violation.
  const [leaveType] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        id: scLeaveTypes.id,
        isArchived: scLeaveTypes.isArchived,
      })
      .from(scLeaveTypes)
      .where(
        and(
          eq(scLeaveTypes.id, parsed.data.leaveTypeId),
          eq(scLeaveTypes.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!leaveType || leaveType.isArchived) {
    return {
      status: "error",
      message: "That leave type isn't available — pick another.",
      fieldErrors: { leaveTypeId: ["Pick an active leave type"] },
    };
  }

  await forTenant(membership.tenant.id).run((tx) =>
    tx.insert(scTimeOffRequests).values({
      traceyTenantId: membership.tenant.id,
      userId: user.id,
      leaveTypeId: parsed.data.leaveTypeId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      reason: parsed.data.reason?.length ? parsed.data.reason : null,
    }),
  );
  revalidatePath("/app/time-off");
  redirect("/app/time-off");
}

async function setRequestStatus(
  id: string,
  next: "approved" | "denied" | "cancelled",
  needsAdmin: boolean,
) {
  const membership = needsAdmin
    ? await requireAdminMembership()
    : await requireAnyMembership();
  const reviewer = await requireUser();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scTimeOffRequests)
      .set({
        status: next,
        reviewedByUserId: reviewer.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(scTimeOffRequests.id, id),
          eq(scTimeOffRequests.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  revalidatePath("/app/time-off");
}

export async function approveTimeOffAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setRequestStatus(id, "approved", true);
}

export async function denyTimeOffAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setRequestStatus(id, "denied", true);
}

export async function cancelOwnTimeOffAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Cancelling own request — no admin required; the SQL update is still
  // tenant-scoped, and the calling page only renders the cancel form on
  // rows the current user submitted.
  await setRequestStatus(id, "cancelled", false);
}
