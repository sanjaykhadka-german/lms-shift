import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  forTenant,
  lmsAssignments,
  lmsDepartmentModulePolicies,
  lmsModules,
  lmsUsers,
} from "@tracey/db";
import { formatDate } from "~/lib/format/datetime";
import { createNotifications } from "./notifications";
import { sendAssignmentsAddedEmail } from "./notify-admin";

const DEFAULT_ASSIGNMENT_VALIDITY_DAYS = 180;

function computeDueAt(validForDays: number | null | undefined, now: Date): Date | null {
  // Mirror assignment_due_from (app.py:209-215): module.valid_for_days
  // overrides default; null means "never expires".
  const days = validForDays ?? DEFAULT_ASSIGNMENT_VALIDITY_DAYS;
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Port of auto_assign_for_department (app.py:259-300). Idempotent — relies
 *  on the unique (user_id, module_id) constraint to ignore duplicates that
 *  win a race. Returns count of new assignments created.
 *
 *  Module.is_published is respected (only published modules are assigned).
 *  Modules already assigned to the user are skipped, regardless of
 *  completed_at status. Tenant-scoped: every read + write filters by
 *  traceyTenantId so a malicious caller can't cross-link tenants. */
export async function autoAssignForDepartment(opts: {
  userId: number;
  departmentId: number | null;
  traceyTenantId: string;
  tenantTimezone: string;
  /** Suppress the summary email side-effect. In-app notifications still fire.
   *  Used by the retroactive policy-save sweep to avoid a burst of emails
   *  when a single tick affects many existing staff. */
  skipEmail?: boolean;
  /** Extra modules to assign on top of the department's policy modules.
   *  Used by the new-employee confirmation modal so admin can pick a few
   *  ad-hoc modules without leaving the create-employee form. Same dedupe,
   *  same notification + email pipeline as the policy modules. */
  additionalModuleIds?: number[];
}): Promise<number> {
  const additional = opts.additionalModuleIds ?? [];
  if (!opts.departmentId && additional.length === 0) return 0;
  const tid = opts.traceyTenantId;

  const tdb = forTenant(tid);
  const insertResult = await tdb.run(async (tx) => {
    const policyRows = opts.departmentId
      ? await tx
          .select({ moduleId: lmsDepartmentModulePolicies.moduleId })
          .from(lmsDepartmentModulePolicies)
          .where(
            and(
              eq(lmsDepartmentModulePolicies.departmentId, opts.departmentId),
              eq(lmsDepartmentModulePolicies.traceyTenantId, tid),
            ),
          )
      : [];
    const requestedIds = Array.from(
      new Set([...policyRows.map((r) => r.moduleId), ...additional]),
    );
    if (requestedIds.length === 0) return { count: 0, inserted: [] as Array<{ moduleId: number; title: string; dueAt: Date | null }> };

    const existingRows = await tx
      .select({ moduleId: lmsAssignments.moduleId })
      .from(lmsAssignments)
      .where(
        and(eq(lmsAssignments.userId, opts.userId), eq(lmsAssignments.traceyTenantId, tid)),
      );
    const existing = new Set(existingRows.map((r) => r.moduleId));

    const candidateIds = requestedIds.filter((mid) => !existing.has(mid));
    if (candidateIds.length === 0) return { count: 0, inserted: [] };

    const candidateModules = await tx
      .select({
        id: lmsModules.id,
        title: lmsModules.title,
        isPublished: lmsModules.isPublished,
        validForDays: lmsModules.validForDays,
      })
      .from(lmsModules)
      .where(and(inArray(lmsModules.id, candidateIds), eq(lmsModules.traceyTenantId, tid)));

    const now = new Date();
    const publishedById = new Map(
      candidateModules
        .filter((m) => m.isPublished === true)
        .map((m) => [m.id, { title: m.title, dueAt: computeDueAt(m.validForDays, now) }]),
    );
    const valuesToInsert = Array.from(publishedById.entries()).map(([moduleId, meta]) => ({
      userId: opts.userId,
      moduleId,
      assignedAt: now,
      dueAt: meta.dueAt,
      traceyTenantId: tid,
    }));

    if (valuesToInsert.length === 0) return { count: 0, inserted: [] };
    // Insert in one batch; if a concurrent insert wins the race on
    // (user_id, module_id), Postgres raises 23505 — swallow and refetch
    // count to stay idempotent.
    try {
      const insertedRows = await tx
        .insert(lmsAssignments)
        .values(valuesToInsert)
        .onConflictDoNothing({ target: [lmsAssignments.userId, lmsAssignments.moduleId] })
        .returning({ id: lmsAssignments.id, moduleId: lmsAssignments.moduleId, dueAt: lmsAssignments.dueAt });
      const inserted = insertedRows.map((r) => {
        const meta = publishedById.get(r.moduleId);
        return {
          moduleId: r.moduleId,
          title: meta?.title ?? "",
          dueAt: r.dueAt ?? null,
        };
      });
      return { count: insertedRows.length, inserted };
    } catch (err) {
      console.error("[autoAssignForDepartment]", err);
      return { count: 0, inserted: [] };
    }
  });

  if (insertResult.count > 0 && insertResult.inserted.length > 0) {
    await notifyAssignmentsAdded(
      tdb,
      opts.userId,
      tid,
      opts.tenantTimezone,
      insertResult.inserted,
      opts.skipEmail === true,
    );
  }
  return insertResult.count;
}

async function notifyAssignmentsAdded(
  tdb: ReturnType<typeof forTenant>,
  userId: number,
  tid: string,
  tenantTimezone: string,
  inserted: Array<{ moduleId: number; title: string; dueAt: Date | null }>,
  skipEmail: boolean,
): Promise<void> {
  try {
    const [recipient] = await tdb.run((tx) =>
      tx
        .select({
          email: lmsUsers.email,
          name: lmsUsers.name,
          traceyUserId: lmsUsers.traceyUserId,
        })
        .from(lmsUsers)
        .where(and(eq(lmsUsers.id, userId), eq(lmsUsers.traceyTenantId, tid)))
        .limit(1),
    );
    if (!recipient) return;

    if (recipient.traceyUserId) {
      await createNotifications(
        tdb,
        inserted.map((m) => ({
          recipientUserId: recipient.traceyUserId!,
          kind: "assignment.created",
          title: `New training: ${m.title}`,
          body: m.dueAt ? `Due ${formatDate(m.dueAt, tenantTimezone)}` : null,
          actionUrl: "/app/my/modules",
        })),
      );
    }

    if (recipient.email && !skipEmail) {
      await sendAssignmentsAddedEmail({
        to: recipient.email,
        name: recipient.name ?? null,
        timezone: tenantTimezone,
        modules: inserted.map((m) => ({ title: m.title, dueAt: m.dueAt })),
      });
    }
  } catch (err) {
    console.error("[autoAssignForDepartment] notify failed", err);
  }
}

/** True iff (departmentId, moduleId) is currently in
 *  department_module_policies for the given tenant. */
export async function policyExists(
  departmentId: number,
  moduleId: number,
  traceyTenantId: string,
): Promise<boolean> {
  const rows = await forTenant(traceyTenantId).run((tx) =>
    tx
      .select({ id: lmsDepartmentModulePolicies.id })
      .from(lmsDepartmentModulePolicies)
      .where(
        and(
          eq(lmsDepartmentModulePolicies.departmentId, departmentId),
          eq(lmsDepartmentModulePolicies.moduleId, moduleId),
          eq(lmsDepartmentModulePolicies.traceyTenantId, traceyTenantId),
        ),
      )
      .limit(1),
  );
  return Boolean(rows[0]);
}
