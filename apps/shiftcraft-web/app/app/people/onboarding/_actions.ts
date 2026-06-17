"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scEmployees,
  scEmployeeOnboardingTasks,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// Default checklist seeded into sc_employee_onboarding_tasks when an admin
// starts onboarding for a new hire. Iterates in array order — sort_order
// is set to the array index so the UI renders them top-to-bottom.
// Tenants without a customised template (none today; a templates surface
// can land in a later slice) all get the same canonical list.
const DEFAULT_TASKS: Array<{
  title: string;
  description?: string;
  required: boolean;
}> = [
  {
    title: "Confirm employment paperwork",
    description: "Signed offer letter and ID copies received.",
    required: true,
  },
  {
    title: "Tax & super forms",
    description: "Tax file declaration and superannuation choice forms.",
    required: true,
  },
  {
    title: "Payroll bank details",
    description: "BSB + account number captured for payroll.",
    required: true,
  },
  {
    title: "Read employee handbook",
    description: "Acknowledge handbook receipt.",
    required: false,
  },
  {
    title: "Safety induction",
    description: "Site walk-through and safety briefing completed.",
    required: true,
  },
];

const employeeSchema = z.object({
  employeeId: z.string().uuid(),
});

const taskSchema = z.object({
  taskId: z.string().uuid(),
  done: z.enum(["true", "false"]),
});

export async function startOnboardingAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = employeeSchema.safeParse({
    employeeId: formData.get("employeeId"),
  });
  if (!parsed.success) throw new Error("Invalid employee id");
  const { employeeId } = parsed.data;

  await forTenant(tenantId).run(async (tx) => {
    // Verify the employee belongs to this tenant — RLS already enforces
    // this, but an explicit guard returns a clearer error than a silent
    // no-op on a forged employeeId.
    const [emp] = await tx
      .select({ id: scEmployees.id, status: scEmployees.onboardingStatus })
      .from(scEmployees)
      .where(eq(scEmployees.id, employeeId))
      .limit(1);
    if (!emp) throw new Error("Employee not found");

    // Only seed tasks the first time onboarding is started. Re-running the
    // action on an already-pending row resets the started_at timestamp
    // without duplicating the checklist.
    const existing = await tx
      .select({ id: scEmployeeOnboardingTasks.id })
      .from(scEmployeeOnboardingTasks)
      .where(eq(scEmployeeOnboardingTasks.employeeId, employeeId))
      .limit(1);

    if (existing.length === 0) {
      await tx.insert(scEmployeeOnboardingTasks).values(
        DEFAULT_TASKS.map((t, idx) => ({
          traceyTenantId: tenantId,
          employeeId,
          title: t.title,
          description: t.description ?? null,
          sortOrder: idx,
          required: t.required,
          status: "pending" as const,
        })),
      );
    }

    await tx
      .update(scEmployees)
      .set({
        onboardingStatus: "pending",
        onboardingStartedAt: new Date(),
        onboardingCompletedAt: null,
      })
      .where(eq(scEmployees.id, employeeId));
  });

  await logAuditEvent({
    action: "shiftcraft.onboarding.started",
    targetKind: "sc_employee",
    targetId: employeeId,
  });

  revalidatePath("/app/people/onboarding");
  revalidatePath(`/app/people/onboarding/${employeeId}`);
  revalidatePath("/app/people/team");
  redirect(`/app/people/onboarding/${employeeId}`);
}

const bulkStartSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
});

// Start onboarding for many employees at once — the batch companion to the
// CSV importer (import 20 staff → start them all in one go). Same seeding as
// startOnboardingAction (default checklist if none exists, status → pending),
// run for each selected employee in a single tenant transaction. Skips ids
// that don't belong to the tenant. Lands back on the hub with a count.
export async function startOnboardingBulkAction(
  formData: FormData,
): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = bulkStartSchema.safeParse({
    employeeIds: formData.getAll("employeeIds").map(String),
  });
  if (!parsed.success) {
    // Nothing valid selected — the submit button guards against this, so
    // just bounce back without changes.
    redirect("/app/people/onboarding");
  }
  const employeeIds = Array.from(new Set(parsed.data.employeeIds));

  let started = 0;
  await forTenant(tenantId).run(async (tx) => {
    // Restrict to employees that actually belong to this tenant (RLS also
    // enforces this; the explicit set keeps the count honest).
    const rows = await tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(inArray(scEmployees.id, employeeIds));
    const valid = new Set(rows.map((r) => r.id));

    for (const employeeId of employeeIds) {
      if (!valid.has(employeeId)) continue;

      const existing = await tx
        .select({ id: scEmployeeOnboardingTasks.id })
        .from(scEmployeeOnboardingTasks)
        .where(eq(scEmployeeOnboardingTasks.employeeId, employeeId))
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(scEmployeeOnboardingTasks).values(
          DEFAULT_TASKS.map((t, idx) => ({
            traceyTenantId: tenantId,
            employeeId,
            title: t.title,
            description: t.description ?? null,
            sortOrder: idx,
            required: t.required,
            status: "pending" as const,
          })),
        );
      }

      await tx
        .update(scEmployees)
        .set({
          onboardingStatus: "pending",
          onboardingStartedAt: new Date(),
          onboardingCompletedAt: null,
        })
        .where(eq(scEmployees.id, employeeId));
      started += 1;
    }
  });

  await logAuditEvent({
    action: "shiftcraft.onboarding.started_bulk",
    targetKind: "sc_employee",
    targetId: null,
    details: { started, requested: employeeIds.length },
  });

  revalidatePath("/app/people/onboarding");
  revalidatePath("/app/people/team");
  redirect(`/app/people/onboarding?started=${started}`);
}

export async function markOnboardingTaskAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = taskSchema.safeParse({
    taskId: formData.get("taskId"),
    done: formData.get("done"),
  });
  if (!parsed.success) throw new Error("Invalid task payload");
  const { taskId, done } = parsed.data;
  const markDone = done === "true";

  const employeeId = await forTenant(tenantId).run(async (tx) => {
    const [task] = await tx
      .select({
        id: scEmployeeOnboardingTasks.id,
        employeeId: scEmployeeOnboardingTasks.employeeId,
      })
      .from(scEmployeeOnboardingTasks)
      .where(eq(scEmployeeOnboardingTasks.id, taskId))
      .limit(1);
    if (!task) throw new Error("Task not found");

    await tx
      .update(scEmployeeOnboardingTasks)
      .set({
        status: markDone ? "done" : "pending",
        completedAt: markDone ? new Date() : null,
        completedByUserId: markDone ? me.id : null,
      })
      .where(eq(scEmployeeOnboardingTasks.id, taskId));

    // First completed task flips the employee from 'pending' to
    // 'in_progress' so the People list shows the work has begun.
    if (markDone) {
      await tx
        .update(scEmployees)
        .set({ onboardingStatus: "in_progress" })
        .where(
          and(
            eq(scEmployees.id, task.employeeId),
            eq(scEmployees.onboardingStatus, "pending"),
          ),
        );
    }

    return task.employeeId;
  });

  revalidatePath(`/app/people/onboarding/${employeeId}`);
  revalidatePath("/app/people/onboarding");
  revalidatePath("/app/people/team");
}

export async function completeOnboardingAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = employeeSchema.safeParse({
    employeeId: formData.get("employeeId"),
  });
  if (!parsed.success) throw new Error("Invalid employee id");
  const { employeeId } = parsed.data;

  await forTenant(tenantId).run(async (tx) => {
    const [emp] = await tx
      .select({ id: scEmployees.id })
      .from(scEmployees)
      .where(eq(scEmployees.id, employeeId))
      .limit(1);
    if (!emp) throw new Error("Employee not found");

    // Block completion if any required task is still pending. The UI
    // hides the button in that state but a server-side guard keeps the
    // invariant if someone forges a POST.
    const pendingRequired = await tx
      .select({ id: scEmployeeOnboardingTasks.id })
      .from(scEmployeeOnboardingTasks)
      .where(
        and(
          eq(scEmployeeOnboardingTasks.employeeId, employeeId),
          eq(scEmployeeOnboardingTasks.required, true),
          inArray(scEmployeeOnboardingTasks.status, ["pending"]),
        ),
      )
      .limit(1);
    if (pendingRequired.length > 0) {
      throw new Error("Required tasks still pending");
    }

    await tx
      .update(scEmployees)
      .set({
        onboardingStatus: "active",
        onboardingCompletedAt: new Date(),
      })
      .where(eq(scEmployees.id, employeeId));
  });

  await logAuditEvent({
    action: "shiftcraft.onboarding.completed",
    targetKind: "sc_employee",
    targetId: employeeId,
  });

  revalidatePath("/app/people/onboarding");
  revalidatePath(`/app/people/onboarding/${employeeId}`);
  revalidatePath("/app/people/team");
}
