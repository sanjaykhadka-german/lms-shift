"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scLeaveTypes,
  scShiftAssignments,
  scTimeOffRequests,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { createNotifications } from "~/lib/notifications";
import { findAffectedShifts } from "~/lib/time-off-impact";

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
  const membership = await requireAdminMembership();
  const reviewer = await requireUser();
  const tenantId = membership.tenant.id;

  // Read the request first so we know whose leave we're approving and
  // which calendar window to scan for fallout. Tenant-scoped lookup
  // guards against an admin sneaking in another tenant's request id.
  const [request] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scTimeOffRequests.id,
        userId: scTimeOffRequests.userId,
        startDate: scTimeOffRequests.startDate,
        endDate: scTimeOffRequests.endDate,
        leaveTypeId: scTimeOffRequests.leaveTypeId,
      })
      .from(scTimeOffRequests)
      .where(
        and(
          eq(scTimeOffRequests.id, id),
          eq(scTimeOffRequests.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!request) return;

  // AUDIT.md #6 close-out: gather assignments overlapping this leave so
  // we can flip them to `declined` in the same tx as the approval. The
  // /app/time-off page already surfaces this list to the admin as the
  // "Impact" disclosure so they see what they're consenting to.
  const affected = await findAffectedShifts(
    tenantId,
    request.userId,
    request.startDate,
    request.endDate,
  );
  const affectedIds = affected.map((s) => s.shiftId);

  await forTenant(tenantId).run(async (tx) => {
    await tx
      .update(scTimeOffRequests)
      .set({
        status: "approved",
        reviewedByUserId: reviewer.id,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(scTimeOffRequests.id, id),
          eq(scTimeOffRequests.traceyTenantId, tenantId),
        ),
      );
    if (affectedIds.length > 0) {
      // Constrain by user + (offered|accepted) so we don't accidentally
      // overwrite a row that flipped to declined/swapped/no_show in the
      // narrow window between read and write.
      await tx
        .update(scShiftAssignments)
        .set({ status: "declined", respondedAt: new Date() })
        .where(
          and(
            eq(scShiftAssignments.userId, request.userId),
            inArray(scShiftAssignments.shiftId, affectedIds),
            inArray(scShiftAssignments.status, ["offered", "accepted"]),
          ),
        );
    }
  });

  // Look up the leave-type name for friendlier audit + notification copy.
  // Best-effort: if the lookup fails we fall back to a generic label.
  let leaveTypeName: string | null = null;
  if (request.leaveTypeId) {
    try {
      const [lt] = await forTenant(tenantId).run((tx) =>
        tx
          .select({ name: scLeaveTypes.name })
          .from(scLeaveTypes)
          .where(eq(scLeaveTypes.id, request.leaveTypeId!))
          .limit(1),
      );
      leaveTypeName = lt?.name ?? null;
    } catch {
      leaveTypeName = null;
    }
  }

  await logAuditEvent({
    action: "shiftcraft.time_off.approved",
    targetKind: "sc_time_off_request",
    targetId: id,
    details: {
      employeeUserId: request.userId,
      startDate: request.startDate,
      endDate: request.endDate,
      leaveTypeName,
      autoDeclinedShifts: affectedIds.length,
    },
  });

  if (affected.length > 0) {
    const window = `${request.startDate} → ${request.endDate}`;
    await createNotifications(
      tenantId,
      affected.map((s) => ({
        recipientUserId: request.userId,
        kind: "shiftcraft.shift.unassigned_leave",
        title: "Shift unassigned — leave approved",
        body: `${s.role}${s.locationName ? ` · ${s.locationName}` : ""} on ${s.startsAt.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — your ${leaveTypeName ?? "leave"} for ${window} was approved.`,
        actionUrl: "/app/my-shifts",
      })),
    );
  }

  revalidatePath("/app/time-off");
  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
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
