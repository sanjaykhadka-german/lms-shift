"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scEmployeeSkills, scSkills } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { deriveSlugFromName, isSkillReferenced } from "~/lib/skills";
import { logAuditEvent } from "~/lib/audit";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

async function requireManager() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers and admins can edit skills.");
  }
  return m;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function createSkillAction(
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
      tx.insert(scSkills).values({
        traceyTenantId: membership.tenant.id,
        name: parsed.data.name,
        slug,
      }),
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("sc_skills_tenant_name_uq")) {
        return {
          status: "error",
          message: "A skill with that name already exists.",
          fieldErrors: { name: ["Pick a different name"] },
        };
      }
      if (err.message.includes("sc_skills_tenant_slug_uq")) {
        return {
          status: "error",
          message: "Generated slug collides — pick a slightly different name.",
          fieldErrors: { name: ["Pick a different name"] },
        };
      }
    }
    throw err;
  }
  await logAuditEvent({
    action: "shiftcraft.skill.created",
    targetKind: "sc_skill",
    details: { name: parsed.data.name, slug },
  });
  revalidatePath("/app/admin/skills");
  return { status: "ok", message: "Added." };
}

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export async function renameSkillAction(
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
        .update(scSkills)
        .set({ name: parsed.data.name, updatedAt: new Date() })
        .where(
          and(
            eq(scSkills.id, parsed.data.id),
            eq(scSkills.traceyTenantId, membership.tenant.id),
          ),
        ),
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("sc_skills_tenant_name_uq")
    ) {
      return {
        status: "error",
        message: "Another skill already has that name.",
        fieldErrors: { name: ["Pick a different name"] },
      };
    }
    throw err;
  }
  await logAuditEvent({
    action: "shiftcraft.skill.renamed",
    targetKind: "sc_skill",
    targetId: parsed.data.id,
    details: { name: parsed.data.name },
  });
  revalidatePath("/app/admin/skills");
  return { status: "ok", message: "Renamed." };
}

export async function toggleArchiveAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  if (!id) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scSkills)
      .set({ isArchived: archive, updatedAt: new Date() })
      .where(
        and(
          eq(scSkills.id, id),
          eq(scSkills.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: archive
      ? "shiftcraft.skill.archived"
      : "shiftcraft.skill.unarchived",
    targetKind: "sc_skill",
    targetId: id,
  });
  revalidatePath("/app/admin/skills");
}

export async function deleteSkillAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const membership = await requireManager();
  // App-side guard for friendlier feedback; the FK is ON DELETE SET
  // NULL on sc_shifts and ON DELETE CASCADE on sc_employee_skills,
  // so a delete WOULD succeed and silently break referencing rows.
  if (await isSkillReferenced(membership.tenant.id, id)) {
    revalidatePath("/app/admin/skills");
    return;
  }
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scSkills)
      .where(
        and(
          eq(scSkills.id, id),
          eq(scSkills.traceyTenantId, membership.tenant.id),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.skill.deleted",
    targetKind: "sc_skill",
    targetId: id,
  });
  revalidatePath("/app/admin/skills");
}

// Toggle a skill membership for an employee. Used by the employee
// edit page's skills chip row. Idempotent — adding an existing
// skill is a no-op via onConflictDoNothing; removing one that
// isn't there is also a no-op.
const employeeSkillSchema = z.object({
  employeeId: z.string().uuid(),
  skillId: z.string().uuid(),
});

export async function addEmployeeSkillAction(
  formData: FormData,
): Promise<void> {
  const parsed = employeeSkillSchema.safeParse({
    employeeId: formData.get("employeeId"),
    skillId: formData.get("skillId"),
  });
  if (!parsed.success) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .insert(scEmployeeSkills)
      .values({
        traceyTenantId: membership.tenant.id,
        employeeId: parsed.data.employeeId,
        skillId: parsed.data.skillId,
      })
      .onConflictDoNothing(),
  );
  revalidatePath(`/app/employees/${parsed.data.employeeId}/edit`);
}

export async function removeEmployeeSkillAction(
  formData: FormData,
): Promise<void> {
  const parsed = employeeSkillSchema.safeParse({
    employeeId: formData.get("employeeId"),
    skillId: formData.get("skillId"),
  });
  if (!parsed.success) return;
  const membership = await requireManager();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .delete(scEmployeeSkills)
      .where(
        and(
          eq(scEmployeeSkills.traceyTenantId, membership.tenant.id),
          eq(scEmployeeSkills.employeeId, parsed.data.employeeId),
          eq(scEmployeeSkills.skillId, parsed.data.skillId),
        ),
      ),
  );
  revalidatePath(`/app/employees/${parsed.data.employeeId}/edit`);
}
