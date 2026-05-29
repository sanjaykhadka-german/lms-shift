"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  lmsDepartmentModulePolicies,
  lmsDepartments,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { autoAssignForDepartment } from "~/lib/lms/admin";
import { isEffectivelyActive } from "~/lib/lms/employee-status";
import { tenantWhere } from "~/lib/lms/tenant-scope";

// Port of /admin/departments/policies POST (app.py:3299-3339). Form posts
// `policy_<dept>_<module>` checkboxes; we diff desired vs existing and only
// write the delta.

export async function saveDepartmentPoliciesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;

  const [departments, moduleRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsDepartments.id })
        .from(lmsDepartments)
        .where(tenantWhere(lmsDepartments, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id })
        .from(lmsModules)
        .where(and(eq(lmsModules.isPublished, true), tenantWhere(lmsModules, tid))),
    ),
  ]);
  const validDepartmentIds = new Set(departments.map((d) => d.id));
  const validModuleIds = new Set(moduleRows.map((m) => m.id));

  // Decode the desired set from posted checkbox keys.
  const desired = new Set<string>(); // "<dept>:<module>"
  for (const key of formData.keys()) {
    if (!key.startsWith("policy_")) continue;
    const parts = key.slice("policy_".length).split("_");
    if (parts.length !== 2) continue;
    const did = parseInt(parts[0]!, 10);
    const mid = parseInt(parts[1]!, 10);
    if (!Number.isFinite(did) || !Number.isFinite(mid)) continue;
    if (validDepartmentIds.has(did) && validModuleIds.has(mid)) {
      desired.add(`${did}:${mid}`);
    }
  }

  const existingRows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsDepartmentModulePolicies.id,
        departmentId: lmsDepartmentModulePolicies.departmentId,
        moduleId: lmsDepartmentModulePolicies.moduleId,
      })
      .from(lmsDepartmentModulePolicies)
      .where(tenantWhere(lmsDepartmentModulePolicies, tid)),
  );
  const existing = new Map<string, number>();
  for (const r of existingRows) {
    existing.set(`${r.departmentId}:${r.moduleId}`, r.id);
  }

  const toAdd: Array<{ departmentId: number; moduleId: number }> = [];
  const toDeleteIds: number[] = [];
  for (const key of desired) {
    if (!existing.has(key)) {
      const [d, m] = key.split(":").map((n) => parseInt(n, 10));
      toAdd.push({ departmentId: d!, moduleId: m! });
    }
  }
  for (const [key, id] of existing) {
    if (!desired.has(key)) toDeleteIds.push(id);
  }

  if (toAdd.length === 0 && toDeleteIds.length === 0) {
    redirect("/app/admin/departments/policies?info=nochange");
  }

  await ctx.db.run(async (tx) => {
    if (toAdd.length > 0) {
      await tx
        .insert(lmsDepartmentModulePolicies)
        .values(toAdd.map((r) => ({ ...r, traceyTenantId: tid })));
    }
    for (const id of toDeleteIds) {
      await tx
        .delete(lmsDepartmentModulePolicies)
        .where(
          and(
            eq(lmsDepartmentModulePolicies.id, id),
            tenantWhere(lmsDepartmentModulePolicies, tid),
          ),
        );
    }
  });

  // Retroactive sweep: for every department that just gained a new policy,
  // auto-assign the policy modules to existing active staff in that department
  // so they see the new training without waiting for a department change.
  // In-app notifications fire; email is suppressed to avoid a burst when a
  // single tick affects many staff.
  let assignedTotal = 0;
  const affectedDeptIds = Array.from(new Set(toAdd.map((r) => r.departmentId)));
  for (const did of affectedDeptIds) {
    const staff = await ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          isActiveFlag: lmsUsers.isActiveFlag,
          terminationDate: lmsUsers.terminationDate,
        })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.departmentId, did), tenantWhere(lmsUsers, tid))),
    );
    for (const u of staff) {
      if (!isEffectivelyActive(u)) continue;
      try {
        const n = await autoAssignForDepartment({
          userId: u.id,
          departmentId: did,
          traceyTenantId: tid,
          tenantTimezone: ctx.tenantTimezone,
          skipEmail: true,
        });
        assignedTotal += n;
      } catch (err) {
        console.error("[policies.sweep] user", u.id, "failed:", err);
      }
    }
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "department.policies_updated",
    targetKind: "department",
    targetId: null as unknown as string,
    details: { added: toAdd.length, removed: toDeleteIds.length, assigned: assignedTotal },
  });

  revalidatePath("/app/admin/departments/policies");
  redirect(
    `/app/admin/departments/policies?ok=1&added=${toAdd.length}&removed=${toDeleteIds.length}&assigned=${assignedTotal}`,
  );
}
