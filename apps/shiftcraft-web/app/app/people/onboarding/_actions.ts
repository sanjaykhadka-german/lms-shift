"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scEmployees,
  scEmployeeOnboardingTasks,
  scOnboardingTaskTemplates,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { notifyOnboardingInvite } from "~/lib/email";

type TenantTx = Parameters<
  Parameters<ReturnType<typeof forTenant>["run"]>[0]
>[0];

interface SeedTask {
  title: string;
  description: string | null;
  required: boolean;
}

// Fallback checklist seeded into sc_employee_onboarding_tasks when a tenant
// has NOT customised its own list (sc_onboarding_task_templates is empty).
// Iterates in array order — sort_order is the array index so the UI renders
// them top-to-bottom. Tenants that define their own templates get those
// instead (see resolveSeedTasks + the /checklist admin surface).
const DEFAULT_TASKS: SeedTask[] = [
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

// Resolve the checklist to seed for a new starter: the tenant's customised
// templates (sc_onboarding_task_templates, in sort order) if any exist,
// otherwise the hardcoded DEFAULT_TASKS. Caller must be inside a
// forTenant().run() tx.
async function resolveSeedTasks(
  tx: TenantTx,
  tenantId: string,
): Promise<SeedTask[]> {
  const templates = await tx
    .select({
      title: scOnboardingTaskTemplates.title,
      description: scOnboardingTaskTemplates.description,
      required: scOnboardingTaskTemplates.required,
    })
    .from(scOnboardingTaskTemplates)
    .where(eq(scOnboardingTaskTemplates.traceyTenantId, tenantId))
    .orderBy(asc(scOnboardingTaskTemplates.sortOrder));
  if (templates.length > 0) {
    return templates.map((t) => ({
      title: t.title,
      description: t.description,
      required: t.required,
    }));
  }
  return DEFAULT_TASKS;
}

const employeeSchema = z.object({
  employeeId: z.string().uuid(),
});

const taskSchema = z.object({
  taskId: z.string().uuid(),
  done: z.enum(["true", "false"]),
});

const templateIdSchema = z.object({
  templateId: z.string().uuid(),
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
      const seedTasks = await resolveSeedTasks(tx, tenantId);
      await tx.insert(scEmployeeOnboardingTasks).values(
        seedTasks.map((t, idx) => ({
          traceyTenantId: tenantId,
          employeeId,
          title: t.title,
          description: t.description,
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
    // Resolve the checklist once for the whole batch (same templates apply to
    // everyone being started).
    const seedTasks = await resolveSeedTasks(tx, tenantId);

    for (const employeeId of employeeIds) {
      if (!valid.has(employeeId)) continue;

      const existing = await tx
        .select({ id: scEmployeeOnboardingTasks.id })
        .from(scEmployeeOnboardingTasks)
        .where(eq(scEmployeeOnboardingTasks.employeeId, employeeId))
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(scEmployeeOnboardingTasks).values(
          seedTasks.map((t, idx) => ({
            traceyTenantId: tenantId,
            employeeId,
            title: t.title,
            description: t.description,
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

// ─── Send onboarding email ───────────────────────────────────────────
//
// Manager nudges an employee to complete their self-service onboarding at
// /app/welcome. If they're not already onboarded, this also puts them in the
// queue (seeds the checklist if missing + flips status to 'pending') so the
// first-login redirect catches them too. Already-completed employees are
// emailed the link without resetting their status. Email is best-effort
// (no RESEND_API_KEY in local dev → silent no-op, rest of the flow still runs).

export async function sendOnboardingEmailAction(
  formData: FormData,
): Promise<void> {
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

  const emp = await forTenant(tenantId).run(async (tx) => {
    const [row] = await tx
      .select({
        id: scEmployees.id,
        email: scEmployees.email,
        fullName: scEmployees.fullName,
        completedAt: scEmployees.onboardingCompletedAt,
      })
      .from(scEmployees)
      .where(eq(scEmployees.id, employeeId))
      .limit(1);
    if (!row) return null;

    // Not yet onboarded → ensure they're in the queue: seed the checklist if
    // it's missing and (re)set status to pending. Don't touch a completed row.
    if (row.completedAt === null) {
      const existing = await tx
        .select({ id: scEmployeeOnboardingTasks.id })
        .from(scEmployeeOnboardingTasks)
        .where(eq(scEmployeeOnboardingTasks.employeeId, employeeId))
        .limit(1);
      if (existing.length === 0) {
        const seedTasks = await resolveSeedTasks(tx, tenantId);
        await tx.insert(scEmployeeOnboardingTasks).values(
          seedTasks.map((t, idx) => ({
            traceyTenantId: tenantId,
            employeeId,
            title: t.title,
            description: t.description,
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
          onboardingStartedAt: sql`COALESCE(${scEmployees.onboardingStartedAt}, NOW())`,
        })
        .where(eq(scEmployees.id, employeeId));
    }
    return row;
  });

  if (!emp) throw new Error("Employee not found");
  if (!emp.email) {
    // No address to send to — bounce back with a flag the page surfaces.
    redirect("/app/people/onboarding?sent=noemail");
  }

  await notifyOnboardingInvite({
    to: { email: emp.email, name: emp.fullName },
    tenantName: membership.tenant.name,
    inviterName: me.name,
  });

  await logAuditEvent({
    action: "shiftcraft.onboarding.email_sent",
    targetKind: "sc_employee",
    targetId: employeeId,
    details: { email: emp.email },
  });

  revalidatePath("/app/people/onboarding");
  redirect("/app/people/onboarding?sent=1");
}

// ─── Checklist template CRUD (the /checklist admin surface) ───

const CHECKLIST_PATH = "/app/people/onboarding/checklist";

async function requireOnboardingManager(): Promise<string> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  return membership.tenant.id;
}

export async function addOnboardingTemplateAction(
  formData: FormData,
): Promise<void> {
  const tenantId = await requireOnboardingManager();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const description =
    String(formData.get("description") ?? "").trim().slice(0, 2000) || null;
  const required = formData.get("required") === "on";
  if (!title) redirect(`${CHECKLIST_PATH}?error=title`);

  await forTenant(tenantId).run(async (tx) => {
    // Append at the end: one past the current max sort_order.
    const [row] = await tx
      .select({
        maxOrder: sql<number>`coalesce(max(${scOnboardingTaskTemplates.sortOrder}), -1)`,
      })
      .from(scOnboardingTaskTemplates)
      .where(eq(scOnboardingTaskTemplates.traceyTenantId, tenantId));
    await tx.insert(scOnboardingTaskTemplates).values({
      traceyTenantId: tenantId,
      title,
      description,
      required,
      sortOrder: Number(row?.maxOrder ?? -1) + 1,
    });
  });

  await logAuditEvent({
    action: "shiftcraft.onboarding.template_added",
    targetKind: "sc_onboarding_task_template",
    details: { title, required },
  });
  revalidatePath(CHECKLIST_PATH);
}

// Populate the template list with the canonical DEFAULT_TASKS so an admin can
// edit from a starting point instead of typing five tasks from scratch.
// No-op if the tenant already has templates.
export async function seedDefaultOnboardingTemplatesAction(): Promise<void> {
  const tenantId = await requireOnboardingManager();
  await forTenant(tenantId).run(async (tx) => {
    const existing = await tx
      .select({ id: scOnboardingTaskTemplates.id })
      .from(scOnboardingTaskTemplates)
      .where(eq(scOnboardingTaskTemplates.traceyTenantId, tenantId))
      .limit(1);
    if (existing.length > 0) return;
    await tx.insert(scOnboardingTaskTemplates).values(
      DEFAULT_TASKS.map((t, idx) => ({
        traceyTenantId: tenantId,
        title: t.title,
        description: t.description,
        required: t.required,
        sortOrder: idx,
      })),
    );
  });
  await logAuditEvent({
    action: "shiftcraft.onboarding.templates_seeded_default",
    targetKind: "sc_onboarding_task_template",
  });
  revalidatePath(CHECKLIST_PATH);
}

export async function updateOnboardingTemplateAction(
  formData: FormData,
): Promise<void> {
  const tenantId = await requireOnboardingManager();
  const id = String(formData.get("templateId") ?? "");
  if (!templateIdSchema.safeParse({ templateId: id }).success) {
    throw new Error("Invalid template id");
  }
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const description =
    String(formData.get("description") ?? "").trim().slice(0, 2000) || null;
  const required = formData.get("required") === "on";
  if (!title) redirect(`${CHECKLIST_PATH}?error=title`);

  await forTenant(tenantId).run((tx) =>
    tx
      .update(scOnboardingTaskTemplates)
      .set({ title, description, required, updatedAt: new Date() })
      .where(
        and(
          eq(scOnboardingTaskTemplates.id, id),
          eq(scOnboardingTaskTemplates.traceyTenantId, tenantId),
        ),
      ),
  );
  revalidatePath(CHECKLIST_PATH);
}

export async function deleteOnboardingTemplateAction(
  formData: FormData,
): Promise<void> {
  const tenantId = await requireOnboardingManager();
  const id = String(formData.get("templateId") ?? "");
  if (!templateIdSchema.safeParse({ templateId: id }).success) {
    throw new Error("Invalid template id");
  }
  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scOnboardingTaskTemplates)
      .where(
        and(
          eq(scOnboardingTaskTemplates.id, id),
          eq(scOnboardingTaskTemplates.traceyTenantId, tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.onboarding.template_deleted",
    targetKind: "sc_onboarding_task_template",
    targetId: id,
  });
  revalidatePath(CHECKLIST_PATH);
}

export async function moveOnboardingTemplateAction(
  formData: FormData,
): Promise<void> {
  const tenantId = await requireOnboardingManager();
  const id = String(formData.get("templateId") ?? "");
  if (!templateIdSchema.safeParse({ templateId: id }).success) {
    throw new Error("Invalid template id");
  }
  const direction = String(formData.get("direction") ?? "");
  if (direction !== "up" && direction !== "down") return;

  await forTenant(tenantId).run(async (tx) => {
    const rows = await tx
      .select({ id: scOnboardingTaskTemplates.id })
      .from(scOnboardingTaskTemplates)
      .where(eq(scOnboardingTaskTemplates.traceyTenantId, tenantId))
      .orderBy(
        asc(scOnboardingTaskTemplates.sortOrder),
        asc(scOnboardingTaskTemplates.createdAt),
      );
    const idx = rows.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= rows.length) return;

    const reordered = [...rows];
    [reordered[idx], reordered[swap]] = [reordered[swap]!, reordered[idx]!];
    // Rewrite every row's sort_order to its array index — self-healing
    // against any pre-existing gaps or duplicate orders.
    for (let i = 0; i < reordered.length; i++) {
      await tx
        .update(scOnboardingTaskTemplates)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(scOnboardingTaskTemplates.id, reordered[i]!.id),
            eq(scOnboardingTaskTemplates.traceyTenantId, tenantId),
          ),
        );
    }
  });
  revalidatePath(CHECKLIST_PATH);
}
