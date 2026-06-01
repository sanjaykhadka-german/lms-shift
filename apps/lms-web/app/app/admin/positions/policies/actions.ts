"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import {
  lmsModules,
  lmsPositionModulePolicies,
  lmsPositions,
  lmsUsers,
} from "@tracey/db";
import { requireAdminAction } from "~/lib/auth/admin";
import { logAuditEvent } from "~/lib/audit";
import { autoAssignForMembership } from "~/lib/lms/admin";
import { isEffectivelyActive } from "~/lib/lms/employee-status";
import { tenantWhere } from "~/lib/lms/tenant-scope";

// Position analogue of saveDepartmentPoliciesAction. Form posts
// `policy_<position>_<module>` checkboxes; we diff desired vs existing and only
// write the delta, then sweep existing staff in the affected positions.

export async function savePositionPoliciesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdminAction();
  const tid = ctx.traceyTenantId;

  const [positions, moduleRows] = await Promise.all([
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsPositions.id })
        .from(lmsPositions)
        .where(tenantWhere(lmsPositions, tid)),
    ),
    ctx.db.run((tx) =>
      tx
        .select({ id: lmsModules.id })
        .from(lmsModules)
        .where(and(eq(lmsModules.isPublished, true), tenantWhere(lmsModules, tid))),
    ),
  ]);
  const validPositionIds = new Set(positions.map((p) => p.id));
  const validModuleIds = new Set(moduleRows.map((m) => m.id));

  // Decode the desired set from posted checkbox keys.
  const desired = new Set<string>(); // "<position>:<module>"
  for (const key of formData.keys()) {
    if (!key.startsWith("policy_")) continue;
    const parts = key.slice("policy_".length).split("_");
    if (parts.length !== 2) continue;
    const pid = parseInt(parts[0]!, 10);
    const mid = parseInt(parts[1]!, 10);
    if (!Number.isFinite(pid) || !Number.isFinite(mid)) continue;
    if (validPositionIds.has(pid) && validModuleIds.has(mid)) {
      desired.add(`${pid}:${mid}`);
    }
  }

  const existingRows = await ctx.db.run((tx) =>
    tx
      .select({
        id: lmsPositionModulePolicies.id,
        positionId: lmsPositionModulePolicies.positionId,
        moduleId: lmsPositionModulePolicies.moduleId,
      })
      .from(lmsPositionModulePolicies)
      .where(tenantWhere(lmsPositionModulePolicies, tid)),
  );
  const existing = new Map<string, number>();
  for (const r of existingRows) {
    existing.set(`${r.positionId}:${r.moduleId}`, r.id);
  }

  const toAdd: Array<{ positionId: number; moduleId: number }> = [];
  const toDeleteIds: number[] = [];
  for (const key of desired) {
    if (!existing.has(key)) {
      const [p, m] = key.split(":").map((n) => parseInt(n, 10));
      toAdd.push({ positionId: p!, moduleId: m! });
    }
  }
  for (const [key, id] of existing) {
    if (!desired.has(key)) toDeleteIds.push(id);
  }

  if (toAdd.length === 0 && toDeleteIds.length === 0) {
    redirect("/app/admin/positions/policies?info=nochange");
  }

  await ctx.db.run(async (tx) => {
    if (toAdd.length > 0) {
      await tx
        .insert(lmsPositionModulePolicies)
        .values(toAdd.map((r) => ({ ...r, traceyTenantId: tid })));
    }
    for (const id of toDeleteIds) {
      await tx
        .delete(lmsPositionModulePolicies)
        .where(
          and(
            eq(lmsPositionModulePolicies.id, id),
            tenantWhere(lmsPositionModulePolicies, tid),
          ),
        );
    }
  });

  // Retroactive sweep: for every position that just gained a new policy,
  // auto-assign the policy modules to existing active staff in that position so
  // they see the new training without waiting for a position change. In-app
  // notifications fire; email is suppressed to avoid a burst when a single tick
  // affects many staff.
  let assignedTotal = 0;
  const affectedPositionIds = Array.from(new Set(toAdd.map((r) => r.positionId)));
  for (const pid of affectedPositionIds) {
    const staff = await ctx.db.run((tx) =>
      tx
        .select({
          id: lmsUsers.id,
          isActiveFlag: lmsUsers.isActiveFlag,
          terminationDate: lmsUsers.terminationDate,
        })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.positionId, pid), tenantWhere(lmsUsers, tid))),
    );
    for (const u of staff) {
      if (!isEffectivelyActive(u)) continue;
      try {
        const n = await autoAssignForMembership({
          userId: u.id,
          positionId: pid,
          traceyTenantId: tid,
          tenantTimezone: ctx.tenantTimezone,
          skipEmail: true,
        });
        assignedTotal += n;
      } catch (err) {
        console.error("[position-policies.sweep] user", u.id, "failed:", err);
      }
    }
  }

  await logAuditEvent({
    tenantId: tid,
    actorUserId: ctx.traceyUserId,
    actorEmail: ctx.lmsUser.email,
    action: "position.policies_updated",
    targetKind: "position",
    targetId: null as unknown as string,
    details: { added: toAdd.length, removed: toDeleteIds.length, assigned: assignedTotal },
  });

  revalidatePath("/app/admin/positions/policies");
  redirect(
    `/app/admin/positions/policies?ok=1&added=${toAdd.length}&removed=${toDeleteIds.length}&assigned=${assignedTotal}`,
  );
}
