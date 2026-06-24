"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  forTenant,
  scDepartments,
  scEmployees,
  scLocations,
  scShiftAssignments,
  scShifts,
  scShiftTemplates,
  scTimesheetApprovals,
  users,
  type ShiftBreak,
} from "@tracey/db";
import { currentMembership, currentUser, requireUser } from "~/lib/auth/current";
import { fmtIsoDate, startOfWeek } from "~/lib/clock";
import {
  resolveBulkCopyTarget,
  type BulkCopyTarget,
  type BulkCopyResolved,
} from "./_bulk-copy";
import { logAuditEvent } from "~/lib/audit";
import { notifyShiftOffered, notifyShiftScheduled } from "~/lib/email";
import { getUnsubscribedUserIds } from "~/lib/email-prefs";
import {
  findApprovedLeaveOverlap,
  findUsersWithLeaveConflict,
} from "~/lib/time-off-impact";
import { checkAvailability } from "~/lib/availability-check";
import { createNotifications, type NotificationInput } from "~/lib/notifications";
import { getNotifyChannel, wantsEmail, wantsInApp } from "~/lib/notify-prefs";
import { emitWebhook } from "~/lib/webhooks";
import { isAtLeastManager } from "~/lib/roles";
import { findAreaTrainingGap } from "~/lib/skills";
import {
  getManagedLocationIds,
  isLocationInScope,
} from "~/lib/manager-scope";

// AUDIT.md #13 — verify the caller's scope covers the given
// locationId. Returns null on success or an error FormState on
// rejection (scoped managers can't touch locations they don't
// manage). Owners + unscoped admins always pass.
async function guardLocationScope(
  tenantId: string,
  userId: string,
  role: string,
  locationId: string | null | undefined,
): Promise<{ status: "error"; message: string } | null> {
  const scope = await getManagedLocationIds(tenantId, userId, role);
  if (isLocationInScope(scope, locationId)) return null;
  return {
    status: "error",
    message: "That location isn't in your management scope.",
  };
}

// Format a leave conflict for the assign-action error message. The
// caller already knows the user; this just renders the leave window
// + type so the admin can see why the assignment failed.
function fmtConflict(c: {
  startDate: string;
  endDate: string;
  leaveTypeName: string | null;
}): string {
  const type = c.leaveTypeName ?? "approved leave";
  if (c.startDate === c.endDate) return `${type} on ${c.startDate}`;
  return `${type} ${c.startDate} → ${c.endDate}`;
}

// ─── Carry assignments when copying a week ────────────────────────────
//
// When a week is copied with "carry staff" on, each cloned shift inherits
// the source shift's accepted assignees. Before re-assigning we check the
// new date against the employee's approved leave + declared availability.
// A conflict is flagged (the assignment is skipped, leaving the cloned
// shift unfilled) unless the manager ticked "override". Used by
// repeatWeekAction.
interface CarryRequest {
  destShiftId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
}
interface CarryConflict {
  userId: string;
  date: string;
  reason: string;
  forced: boolean;
}

async function buildCarriedAssignments(
  tenantId: string,
  requests: CarryRequest[],
  availabilityByUser: Map<string, Record<string, string> | null>,
  force: boolean,
): Promise<{
  values: Array<typeof scShiftAssignments.$inferInsert>;
  conflicts: CarryConflict[];
}> {
  const values: Array<typeof scShiftAssignments.$inferInsert> = [];
  const conflicts: CarryConflict[] = [];
  for (const r of requests) {
    let reason: string | null = null;
    const leave = await findApprovedLeaveOverlap(
      tenantId,
      r.userId,
      r.startsAt,
      r.endsAt,
    );
    if (leave.length > 0) {
      reason = fmtConflict(leave[0]!);
    } else {
      const avail = checkAvailability(
        availabilityByUser.get(r.userId) ?? null,
        r.startsAt,
        r.endsAt,
      );
      if (avail.kind === "mismatch") reason = avail.reason;
    }
    const date = r.startsAt.toISOString().slice(0, 10);
    if (reason && !force) {
      // Skip — leave the cloned shift unfilled and flag it for the admin.
      conflicts.push({ userId: r.userId, date, reason, forced: false });
      continue;
    }
    if (reason) {
      // Overridden: still flag it (for the audit trail) but assign anyway.
      conflicts.push({ userId: r.userId, date, reason, forced: true });
    }
    values.push({
      shiftId: r.destShiftId,
      userId: r.userId,
      status: "accepted",
      respondedAt: new Date(),
    });
  }
  return { values, conflicts };
}

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[]>;
      // Set when the only blocker is a leave/availability conflict a manager
      // may override by re-submitting with force. Drives the "assign anyway"
      // affordance in _assign-form.tsx.
      canOverride?: boolean;
    };

const shiftSchema = z
  .object({
    locationId: z.string().uuid("Pick a location"),
    role: z.string().trim().min(1, "Role is required").max(80),
    startsAt: z
      .string()
      .min(1, "Start time is required")
      .transform((s) => new Date(s)),
    endsAt: z
      .string()
      .min(1, "End time is required")
      .transform((s) => new Date(s)),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    // AUDIT.md #8 — empty string maps to null (no skill required);
    // a UUID is validated against sc_skills server-side via the FK.
    requiredSkillId: z
      .string()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .refine((v) => v.startsAt instanceof Date && !isNaN(v.startsAt.getTime()), {
    path: ["startsAt"],
    message: "Invalid start time",
  })
  .refine((v) => v.endsAt instanceof Date && !isNaN(v.endsAt.getTime()), {
    path: ["endsAt"],
    message: "Invalid end time",
  })
  .refine((v) => v.endsAt > v.startsAt, {
    path: ["endsAt"],
    message: "End must be after start",
  });

async function requireTenant() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace to manage shifts.");
  return m.tenant;
}

// Breaks arrive as a JSON string from the form (a dynamic row list). Validate,
// drop zero-minute rows, and derive the paid/unpaid totals kept on the shift.
const breakEntrySchema = z.object({
  label: z.string().trim().max(40).nullish(),
  minutes: z.coerce.number().int().min(0).max(1440),
  paid: z.coerce.boolean(),
});

function parseBreaks(raw: FormDataEntryValue | null): {
  breaks: ShiftBreak[];
  paidTotal: number;
  unpaidTotal: number;
} {
  let arr: unknown = [];
  if (typeof raw === "string" && raw.trim()) {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
  }
  const parsed = z.array(breakEntrySchema).safeParse(arr);
  const list = parsed.success ? parsed.data : [];
  const breaks: ShiftBreak[] = list
    .filter((b) => b.minutes > 0)
    .map((b) => ({
      label: b.label && b.label.trim() ? b.label.trim() : null,
      minutes: b.minutes,
      paid: b.paid,
    }));
  const paidTotal = breaks
    .filter((b) => b.paid)
    .reduce((s, b) => s + b.minutes, 0);
  const unpaidTotal = breaks
    .filter((b) => !b.paid)
    .reduce((s, b) => s + b.minutes, 0);
  return { breaks, paidTotal, unpaidTotal };
}

// A shift is "started" once its start time is in the past. Started shifts may
// not be moved/retimed (drag, or editing the start time); their other fields
// stay editable. Server-enforced here; the UI mirrors it by disabling the drag
// handle and the start-time input.
function hasStarted(startsAt: Date): boolean {
  return startsAt.getTime() <= Date.now();
}

// Build the soft "not trained for this area" warning string for putting a user
// on a shift (items 4 & 7), or null when there's nothing to flag. Never blocks.
function fmtTrainingGap(
  gap: { areaName: string; missing: string[] } | null,
): string | null {
  if (!gap) return null;
  return `Heads up — not trained for ${gap.areaName}: missing ${gap.missing.join(", ")}.`;
}

async function trainingWarningForShift(
  tenantId: string,
  shiftId: string,
  userId: string,
): Promise<string | null> {
  const [shift] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ locationId: scShifts.locationId, role: scShifts.role })
      .from(scShifts)
      .where(
        and(eq(scShifts.id, shiftId), eq(scShifts.traceyTenantId, tenantId)),
      )
      .limit(1),
  );
  if (!shift) return null;
  return fmtTrainingGap(
    await findAreaTrainingGap(tenantId, shift.locationId, shift.role, userId),
  );
}

// Kati's rostering feedback #4/#7 — the roster locks once a shift starts.
// Copying/assigning a shift into the past produces wrong rosters and wrong
// pay, so every copy/assign/delete path refuses a target that's already
// started (via hasStarted above). Same-day-not-yet-started stays editable —
// the boundary is the start instant, not the calendar day.

// Kati's rostering feedback #7 — a week whose timesheet has been approved is
// frozen for payroll. Deleting/retiming a shift in an approved week would
// desync the roster from the signed-off timesheet, so we block it. Mirrors
// assertWeekUnlocked() in timesheets/event-actions.ts, but checks per
// employee for a single shift date. Returns true when any of the given
// users' covering week is approved.
async function hasApprovedTimesheet(
  tenantId: string,
  userIds: string[],
  date: Date,
): Promise<boolean> {
  if (userIds.length === 0) return false;
  const weekStartIso = fmtIsoDate(startOfWeek(date));
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({ status: scTimesheetApprovals.status })
      .from(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, tenantId),
          inArray(scTimesheetApprovals.employeeUserId, userIds),
          eq(scTimesheetApprovals.status, "approved"),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      )
      .limit(1),
  );
  return Boolean(row);
}

// Kati's rostering feedback #8 — double-booking guard. Returns the first
// ACCEPTED assignment in any area whose shift window overlaps [startsAt,
// endsAt) for this user, excluding the current shift. Standard interval
// overlap (other.start < end AND other.end > start), mirroring
// findApprovedLeaveOverlap. ISO strings + ::timestamptz casts per the
// sql-template type-hint convention used elsewhere in this file.
async function findOverlappingAssignment(
  tenantId: string,
  userId: string,
  startsAt: Date,
  endsAt: Date,
  excludeShiftId: string,
): Promise<{ startsAt: Date; endsAt: Date; locationName: string | null } | null> {
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          eq(scShiftAssignments.userId, userId),
          eq(scShiftAssignments.status, "accepted"),
          sql`${scShiftAssignments.shiftId} <> ${excludeShiftId}`,
          sql`${scShifts.startsAt} < ${endsAt.toISOString()}::timestamptz`,
          sql`${scShifts.endsAt} > ${startsAt.toISOString()}::timestamptz`,
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

// Render a shift window as "09:00–17:15 in Dispatch" for conflict messages.
// Uses the server-local frame the rest of this file reasons about dates in.
function fmtShiftWindow(
  startsAt: Date,
  endsAt: Date,
  locationName: string | null,
): string {
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  const where = locationName ? ` in ${locationName}` : "";
  return `${hhmm(startsAt)}–${hhmm(endsAt)}${where}`;
}

export async function createShiftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shiftSchema.safeParse({
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    notes: formData.get("notes") ?? "",
    requiredSkillId: formData.get("requiredSkillId") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { breaks, paidTotal, unpaidTotal } = parseBreaks(formData.get("breaks"));

  const tenant = await requireTenant();
  const user = await currentUser();
  // AUDIT.md #13 — refuse to create a shift at a location the
  // manager isn't scoped to. Owners + unscoped admins pass through.
  if (user) {
    const membership = await currentMembership();
    if (membership) {
      const scopeErr = await guardLocationScope(
        tenant.id,
        user.id,
        membership.role,
        parsed.data.locationId,
      );
      if (scopeErr) return scopeErr;
    }
  }
  await forTenant(tenant.id).run((tx) =>
    tx.insert(scShifts).values({
      traceyTenantId: tenant.id,
      locationId: parsed.data.locationId,
      role: parsed.data.role,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      notes: parsed.data.notes?.length ? parsed.data.notes : null,
      breaks,
      breakPaidMinutes: paidTotal,
      breakUnpaidMinutes: unpaidTotal,
      requiredSkillId: parsed.data.requiredSkillId,
      createdByUserId: user?.id ?? null,
    }),
  );
  revalidatePath("/app/schedule");
  redirect("/app/schedule");
}

export async function updateShiftAction(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shiftSchema.safeParse({
    locationId: formData.get("locationId"),
    role: formData.get("role"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    notes: formData.get("notes") ?? "",
    requiredSkillId: formData.get("requiredSkillId") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { breaks, paidTotal, unpaidTotal } = parseBreaks(formData.get("breaks"));

  const tenant = await requireTenant();
  // AUDIT.md #13 — scope check on both the destination location AND
  // the shift's current location (a scoped manager mustn't be able to
  // move a shift OUT of their scope nor INTO their scope without
  // rights to the source).
  const user = await currentUser();
  if (user) {
    const membership = await currentMembership();
    if (membership) {
      const [existing] = await forTenant(tenant.id).run((tx) =>
        tx
          .select({ locationId: scShifts.locationId })
          .from(scShifts)
          .where(
            and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)),
          )
          .limit(1),
      );
      const scopeErr =
        (await guardLocationScope(
          tenant.id,
          user.id,
          membership.role,
          parsed.data.locationId,
        )) ??
        (existing
          ? await guardLocationScope(
              tenant.id,
              user.id,
              membership.role,
              existing.locationId,
            )
          : null);
      if (scopeErr) return scopeErr;
    }
  }
  // Kati's rostering feedback #7 — a started shift is locked entirely (not
  // just its start time): editing it after the fact desyncs the roster from
  // what actually happened. Same-day-not-yet-started stays editable. A shift
  // whose timesheet week is approved is frozen for payroll too.
  const [existingShift] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({ startsAt: scShifts.startsAt })
      .from(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)))
      .limit(1),
  );
  if (existingShift && hasStarted(existingShift.startsAt)) {
    return {
      status: "error",
      message: "This shift has already started — it can no longer be edited.",
    };
  }
  if (existingShift) {
    const assignees = await forTenant(tenant.id).run((tx) =>
      tx
        .select({ userId: scShiftAssignments.userId })
        .from(scShiftAssignments)
        .where(
          and(
            eq(scShiftAssignments.shiftId, id),
            eq(scShiftAssignments.status, "accepted"),
          ),
        ),
    );
    if (
      await hasApprovedTimesheet(
        tenant.id,
        assignees.map((a) => a.userId),
        existingShift.startsAt,
      )
    ) {
      return {
        status: "error",
        message:
          "This shift's timesheet week is approved — reopen it before editing.",
      };
    }
  }
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({
        locationId: parsed.data.locationId,
        role: parsed.data.role,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        notes: parsed.data.notes?.length ? parsed.data.notes : null,
        breaks,
        breakPaidMinutes: paidTotal,
        breakUnpaidMinutes: unpaidTotal,
        requiredSkillId: parsed.data.requiredSkillId,
        updatedAt: new Date(),
      })
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  revalidatePath(`/app/schedule/${id}/edit`);
  return { status: "ok", message: "Saved." };
}

export async function bulkPublishWeekAction(formData: FormData): Promise<void> {
  const weekStart = String(formData.get("weekStart") ?? "");
  const weekEnd = String(formData.get("weekEnd") ?? "");
  const locationId = String(formData.get("location") ?? "");
  // Optional area scope: publish only this role's shifts (location + role).
  const role = String(formData.get("role") ?? "").trim();
  if (!weekStart || !weekEnd) return;

  // Admin-only: surface the same error message as single-shift publish.
  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(membership.role)) {
    throw new Error("Only admins can publish shifts.");
  }

  // Pass ISO strings + explicit ::timestamptz cast inside the sql template.
  // Drizzle's `sql` tag has no column-type info, so a raw Date would reach
  // postgres-js (prepare:false) without a type hint and trip its
  // Buffer.byteLength path — see locations/page.tsx for the same pattern.
  const startsAtIso = new Date(weekStart).toISOString();
  const endsAtIso = new Date(weekEnd).toISOString();
  const conditions = [
    eq(scShifts.traceyTenantId, membership.tenant.id),
    // "Needs publish" = a never-published draft OR a published shift edited
    // since it last went live (updatedAt advanced past publishedAt). Cancelled
    // shifts are excluded by construction.
    sql`(${scShifts.status} = 'draft' or (${scShifts.status} = 'published' and (${scShifts.publishedAt} is null or ${scShifts.updatedAt} > ${scShifts.publishedAt})))`,
    sql`${scShifts.startsAt} >= ${startsAtIso}::timestamptz`,
    sql`${scShifts.startsAt} < ${endsAtIso}::timestamptz`,
  ];
  if (locationId) conditions.push(eq(scShifts.locationId, locationId));
  if (role) conditions.push(eq(scShifts.role, role));

  // Capture the IDs of the shifts that will flip so we can fan out
  // webhooks afterwards. RETURNING on the same UPDATE keeps the round
  // trip count at one.
  const published = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
      }),
  );

  // AUDIT.md #10 — one webhook per shift. emitWebhook short-circuits
  // when there are no subscriptions, so the N round-trips are
  // typically just N table peeks against an empty result set.
  for (const s of published) {
    await emitWebhook(membership.tenant.id, "shift.published", {
      shiftId: s.id,
      locationId: s.locationId,
      role: s.role,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      bulk: true,
    });
  }

  // Notify accepted assignees now that their shifts are live.
  await notifyAcceptedAssignees(
    membership.tenant.id,
    published.map((s) => s.id),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
}

// Publish the week's pending changes for a hand-picked set of areas
// (location + role), chosen via checkboxes in the Publish menu. An empty
// `areas` list publishes the whole week (the "Publish all" case). Same
// publish core as bulkPublishWeekAction: flip status, stamp publishedAt,
// fan out webhooks, notify accepted assignees.
const publishAreasSchema = z.object({
  weekStartIso: z.string().min(1),
  weekEndIso: z.string().min(1),
  areas: z
    .array(
      z.object({
        locationId: z.string().uuid(),
        role: z.string().trim().min(1).max(80),
      }),
    )
    .max(500),
});

export async function bulkPublishSelectedAreasAction(input: {
  weekStartIso: string;
  weekEndIso: string;
  areas: Array<{ locationId: string; role: string }>;
}): Promise<{ ok: boolean; published: number; message?: string }> {
  const parsed = publishAreasSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, published: 0, message: "Nothing to publish." };
  }
  const { weekStartIso, weekEndIso, areas } = parsed.data;

  const membership = await currentMembership();
  if (!membership) return { ok: false, published: 0, message: "Not signed in." };
  if (!isAtLeastManager(membership.role)) {
    return { ok: false, published: 0, message: "Only admins can publish shifts." };
  }

  const startsAtIso = new Date(weekStartIso).toISOString();
  const endsAtIso = new Date(weekEndIso).toISOString();
  const conditions = [
    eq(scShifts.traceyTenantId, membership.tenant.id),
    sql`(${scShifts.status} = 'draft' or (${scShifts.status} = 'published' and (${scShifts.publishedAt} is null or ${scShifts.updatedAt} > ${scShifts.publishedAt})))`,
    sql`${scShifts.startsAt} >= ${startsAtIso}::timestamptz`,
    sql`${scShifts.startsAt} < ${endsAtIso}::timestamptz`,
  ];
  if (areas.length > 0) {
    const orCond = or(
      ...areas.map((a) =>
        and(eq(scShifts.locationId, a.locationId), eq(scShifts.role, a.role)),
      ),
    );
    if (orCond) conditions.push(orCond);
  }

  const published = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
      }),
  );

  for (const s of published) {
    await emitWebhook(membership.tenant.id, "shift.published", {
      shiftId: s.id,
      locationId: s.locationId,
      role: s.role,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      bulk: true,
    });
  }
  await notifyAcceptedAssignees(
    membership.tenant.id,
    published.map((s) => s.id),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  return { ok: true, published: published.length };
}

// Re-publish ONLY shifts that were already published and then moved/amended
// (updatedAt advanced past publishedAt). Unlike bulkPublish*, this deliberately
// leaves never-published drafts untouched — its job is to push the *changed*
// version of live shifts back out to staff (item 2: a moved/amended shift must
// be re-published). Re-stamps publishedAt so the "edited since publish" flag
// clears, fans out webhooks, and re-notifies accepted assignees.
const republishSchema = z.object({
  weekStartIso: z.string().min(1),
  weekEndIso: z.string().min(1),
  location: z.string().uuid().optional(),
});

export async function republishEditedShiftsAction(input: {
  weekStartIso: string;
  weekEndIso: string;
  location?: string;
}): Promise<{ ok: boolean; published: number; message?: string }> {
  const parsed = republishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, published: 0, message: "Nothing to re-publish." };
  }
  const { weekStartIso, weekEndIso, location } = parsed.data;

  const membership = await currentMembership();
  if (!membership) return { ok: false, published: 0, message: "Not signed in." };
  if (!isAtLeastManager(membership.role)) {
    return { ok: false, published: 0, message: "Only admins can publish shifts." };
  }

  const startsAtIso = new Date(weekStartIso).toISOString();
  const endsAtIso = new Date(weekEndIso).toISOString();
  // Single timestamp for both columns so updatedAt == publishedAt exactly and
  // the "edited since publish" predicate goes false immediately after.
  const now = new Date();
  const conditions = [
    eq(scShifts.traceyTenantId, membership.tenant.id),
    // Published-and-edited only — never-published drafts are excluded here.
    sql`(${scShifts.status} = 'published' and (${scShifts.publishedAt} is null or ${scShifts.updatedAt} > ${scShifts.publishedAt}))`,
    sql`${scShifts.startsAt} >= ${startsAtIso}::timestamptz`,
    sql`${scShifts.startsAt} < ${endsAtIso}::timestamptz`,
  ];
  if (location) conditions.push(eq(scShifts.locationId, location));

  const published = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: "published", publishedAt: now, updatedAt: now })
      .where(and(...conditions))
      .returning({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
      }),
  );

  for (const s of published) {
    await emitWebhook(membership.tenant.id, "shift.published", {
      shiftId: s.id,
      locationId: s.locationId,
      role: s.role,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      bulk: true,
    });
  }
  await notifyAcceptedAssignees(
    membership.tenant.id,
    published.map((s) => s.id),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  return { ok: true, published: published.length };
}

/**
 * Duplicate every shift in [weekStart, weekStart+7d) forward by 7 days,
 * inserting the copies as drafts. Skips a source shift if the
 * destination week already has a shift at the same (day-of-week,
 * time-of-day, location, role) — that's the common "I already filled
 * this slot manually" case.
 *
 * Assignments are not copied — the destination shifts come up empty so
 * the manager can offer them to whoever's available next week.
 *
 * After the copy completes, the action redirects to /app/schedule with
 * `?copied=N&skipped=M` so the page can flash a confirmation banner.
 */
export async function duplicateWeekAction(formData: FormData): Promise<void> {
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  if (!weekStartRaw) return;
  const locationId = String(formData.get("location") ?? "");

  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(membership.role)) {
    throw new Error("Only admins can duplicate a week.");
  }
  const tenantId = membership.tenant.id;
  const me = await currentUser();

  const sourceStart = new Date(weekStartRaw);
  if (Number.isNaN(sourceStart.getTime())) return;
  const sourceEnd = new Date(sourceStart);
  sourceEnd.setDate(sourceEnd.getDate() + 7);
  const destStart = new Date(sourceEnd);
  const destEnd = new Date(destStart);
  destEnd.setDate(destEnd.getDate() + 7);

  const sourceStartIso = sourceStart.toISOString();
  const sourceEndIso = sourceEnd.toISOString();
  const destStartIso = destStart.toISOString();
  const destEndIso = destEnd.toISOString();

  // Source week: all shifts in [sourceStart, sourceEnd). Filtered by
  // location if the user is browsing a specific site so the copy stays
  // focused on what they're currently looking at.
  const sourceShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${sourceStartIso}::timestamptz`,
          sql`${scShifts.startsAt} < ${sourceEndIso}::timestamptz`,
          locationId ? eq(scShifts.locationId, locationId) : undefined,
        ),
      ),
  );

  // Destination week: pull the same set so we can de-dupe in code.
  // Comparing (locationId, role, startsAt-shifted) catches the
  // common case without trying to be clever about partial overlaps.
  const destShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${destStartIso}::timestamptz`,
          sql`${scShifts.startsAt} < ${destEndIso}::timestamptz`,
        ),
      ),
  );

  // Key shape: "<locationId>|<role>|<startMs>". startMs is the
  // destination week's milliseconds since epoch; the source-week loop
  // shifts forward by exactly 7 * 86400000 so collisions line up.
  const destKeys = new Set<string>();
  for (const d of destShifts) {
    destKeys.add(
      `${d.locationId}|${d.role}|${d.startsAt.getTime()}`,
    );
  }

  const SHIFT_MS = 7 * 24 * 60 * 60 * 1000;
  let copied = 0;
  let skipped = 0;
  const toInsert: Array<{
    traceyTenantId: string;
    locationId: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
    status: "draft";
    notes: string | null;
    createdByUserId: string | null;
  }> = [];
  for (const s of sourceShifts) {
    const newStart = new Date(s.startsAt.getTime() + SHIFT_MS);
    const newEnd = new Date(s.endsAt.getTime() + SHIFT_MS);
    const key = `${s.locationId}|${s.role}|${newStart.getTime()}`;
    if (destKeys.has(key)) {
      skipped += 1;
      continue;
    }
    toInsert.push({
      traceyTenantId: tenantId,
      locationId: s.locationId,
      role: s.role,
      startsAt: newStart,
      endsAt: newEnd,
      status: "draft",
      notes: s.notes,
      createdByUserId: me?.id ?? null,
    });
    // Reserve the slot so the same source week can't insert two
    // duplicates of itself (defensive — shouldn't happen with the
    // current data shape).
    destKeys.add(key);
    copied += 1;
  }

  if (toInsert.length > 0) {
    await forTenant(tenantId).run((tx) =>
      tx.insert(scShifts).values(toInsert),
    );
  }

  await logAuditEvent({
    action: "shiftcraft.schedule.week_duplicated",
    targetKind: "sc_schedule_week",
    details: {
      from: sourceStartIso.slice(0, 10),
      to: destStartIso.slice(0, 10),
      copied,
      skipped,
      locationFilter: locationId || null,
    },
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  // Send the user to the destination week so they immediately see the
  // newly created drafts, with counters in the query string so the
  // page can flash a confirmation.
  const destWeekParam = destStart.toISOString().slice(0, 10);
  const search = new URLSearchParams({
    week: destWeekParam,
    copied: String(copied),
    skipped: String(skipped),
  });
  if (locationId) search.set("location", locationId);
  redirect(`/app/schedule?${search.toString()}`);
}

// Repeat the current week forward into the next N weeks in one go (the "Copy
// week" control). Generalizes duplicateWeekAction (which only did +1 week):
// every shift in [weekStart, weekStart+7d) is copied onto each of the next N
// weeks as a draft — carrying breaks + required skill — skipping any
// destination slot that already has a shift at the same (location, role,
// time-of-day). Assignments are not copied. Respects the active location
// filter. Fixed 7-day-ms offsets keep time-of-day exact, matching
// duplicateWeekAction.
export async function repeatWeekAction(formData: FormData): Promise<void> {
  const weekStartRaw = String(formData.get("weekStart") ?? "");
  if (!weekStartRaw) return;
  const locationId = String(formData.get("location") ?? "");
  // Optional area scope: copy only this role's shifts. Combined with the
  // location filter this is the (location, role) "area" the grid groups by.
  const role = String(formData.get("role") ?? "").trim();
  // Clamp to 1..12 so a stray value can't spawn a year of drafts.
  const weeksRaw = Number(formData.get("weeks") ?? 1);
  const weeks = Number.isFinite(weeksRaw)
    ? Math.min(12, Math.max(1, Math.trunc(weeksRaw)))
    : 1;
  // Carry the source week's accepted assignees onto the cloned shifts (default
  // on). `force` re-assigns even when the new date conflicts with the
  // employee's approved leave or declared availability.
  const carryAssignments = formData.get("carryAssignments") !== "off";
  const force = formData.get("force") === "on";

  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(membership.role)) {
    throw new Error("Only admins can copy a week.");
  }
  const tenantId = membership.tenant.id;
  const me = await currentUser();

  const sourceStart = new Date(weekStartRaw);
  if (Number.isNaN(sourceStart.getTime())) return;
  const sourceEnd = new Date(sourceStart);
  sourceEnd.setDate(sourceEnd.getDate() + 7);
  // Destination span: the N weeks immediately after the source week. Pulled in
  // one query so collisions across all target weeks are deduped in code.
  const destRangeStart = new Date(sourceEnd);
  const destRangeEnd = new Date(sourceStart);
  destRangeEnd.setDate(destRangeEnd.getDate() + 7 * (weeks + 1));

  const sourceShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${sourceStart.toISOString()}::timestamptz`,
          sql`${scShifts.startsAt} < ${sourceEnd.toISOString()}::timestamptz`,
          locationId ? eq(scShifts.locationId, locationId) : undefined,
          role ? eq(scShifts.role, role) : undefined,
        ),
      ),
  );

  // When carrying assignments, pull the accepted assignees for the source
  // shifts plus each assignee's availability (for the conflict check below).
  const assigneesBySourceShift = new Map<string, string[]>();
  const availabilityByUser = new Map<string, Record<string, string> | null>();
  if (carryAssignments && sourceShifts.length > 0) {
    const sourceIds = sourceShifts.map((s) => s.id);
    const assignmentRows = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          shiftId: scShiftAssignments.shiftId,
          userId: scShiftAssignments.userId,
        })
        .from(scShiftAssignments)
        .where(
          and(
            inArray(scShiftAssignments.shiftId, sourceIds),
            eq(scShiftAssignments.status, "accepted"),
          ),
        ),
    );
    for (const a of assignmentRows) {
      const arr = assigneesBySourceShift.get(a.shiftId) ?? [];
      arr.push(a.userId);
      assigneesBySourceShift.set(a.shiftId, arr);
    }
    const userIds = [...new Set(assignmentRows.map((a) => a.userId))];
    if (userIds.length > 0) {
      const empRows = await forTenant(tenantId).run((tx) =>
        tx
          .select({
            appUserId: scEmployees.appUserId,
            availability: scEmployees.availability,
          })
          .from(scEmployees)
          .where(
            and(
              eq(scEmployees.traceyTenantId, tenantId),
              inArray(scEmployees.appUserId, userIds),
            ),
          ),
      );
      for (const e of empRows) {
        if (e.appUserId) {
          availabilityByUser.set(
            e.appUserId,
            (e.availability as Record<string, string> | null) ?? null,
          );
        }
      }
    }
  }

  const destShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${destRangeStart.toISOString()}::timestamptz`,
          sql`${scShifts.startsAt} < ${destRangeEnd.toISOString()}::timestamptz`,
        ),
      ),
  );

  const destKeys = new Set<string>();
  for (const d of destShifts) {
    destKeys.add(`${d.locationId}|${d.role}|${d.startsAt.getTime()}`);
  }

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let copied = 0;
  let skipped = 0;
  const toInsert: Array<typeof scShifts.$inferInsert> = [];
  // Parallel to toInsert: which source shift each clone came from + its new
  // window, so we can re-attach the carried assignees once the rows have IDs.
  const insertMeta: Array<{ sourceShiftId: string; startsAt: Date; endsAt: Date }> = [];
  for (let k = 1; k <= weeks; k++) {
    const offsetMs = k * WEEK_MS;
    for (const s of sourceShifts) {
      const newStart = new Date(s.startsAt.getTime() + offsetMs);
      const newEnd = new Date(s.endsAt.getTime() + offsetMs);
      // Kati's rostering feedback #4 — never clone into the past (a past source
      // week copied forward can still land in the past).
      if (hasStarted(newStart)) {
        skipped += 1;
        continue;
      }
      const key = `${s.locationId}|${s.role}|${newStart.getTime()}`;
      if (destKeys.has(key)) {
        skipped += 1;
        continue;
      }
      toInsert.push({
        traceyTenantId: tenantId,
        locationId: s.locationId,
        role: s.role,
        startsAt: newStart,
        endsAt: newEnd,
        status: "draft",
        notes: s.notes,
        breaks: s.breaks,
        breakPaidMinutes: s.breakPaidMinutes,
        breakUnpaidMinutes: s.breakUnpaidMinutes,
        requiredSkillId: s.requiredSkillId,
        createdByUserId: me?.id ?? null,
      });
      insertMeta.push({ sourceShiftId: s.id, startsAt: newStart, endsAt: newEnd });
      destKeys.add(key);
      copied += 1;
    }
  }

  let assigned = 0;
  let flagged = 0;
  if (toInsert.length > 0) {
    await forTenant(tenantId).run(async (tx) => {
      // RETURNING ids come back in VALUES order, so we can zip against
      // insertMeta to map each clone to its source shift's assignees.
      const inserted = await tx
        .insert(scShifts)
        .values(toInsert)
        .returning({ id: scShifts.id });

      if (carryAssignments) {
        const requests: CarryRequest[] = [];
        inserted.forEach((row, i) => {
          const meta = insertMeta[i]!;
          for (const userId of assigneesBySourceShift.get(meta.sourceShiftId) ?? []) {
            requests.push({
              destShiftId: row.id,
              userId,
              startsAt: meta.startsAt,
              endsAt: meta.endsAt,
            });
          }
        });
        if (requests.length > 0) {
          const { values, conflicts } = await buildCarriedAssignments(
            tenantId,
            requests,
            availabilityByUser,
            force,
          );
          assigned = values.length;
          // Flagged = conflicts that were skipped (not forced through).
          flagged = conflicts.filter((c) => !c.forced).length;
          if (values.length > 0) {
            await tx
              .insert(scShiftAssignments)
              .values(values)
              .onConflictDoNothing();
          }
        }
      }
    });
  }

  await logAuditEvent({
    action: "shiftcraft.schedule.week_repeated",
    targetKind: "sc_schedule_week",
    details: {
      from: sourceStart.toISOString().slice(0, 10),
      weeks,
      copied,
      skipped,
      carryAssignments,
      force,
      assigned,
      flagged,
      locationFilter: locationId || null,
      roleFilter: role || null,
    },
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  // Land on the first copied week so the manager immediately sees the new
  // drafts, with totals across all N weeks in the flash.
  const search = new URLSearchParams({
    week: destRangeStart.toISOString().slice(0, 10),
    copied: String(copied),
    skipped: String(skipped),
  });
  if (assigned > 0) search.set("assigned", String(assigned));
  if (flagged > 0) search.set("flagged", String(flagged));
  if (locationId) search.set("location", locationId);
  redirect(`/app/schedule?${search.toString()}`);
}

// Copy every shift on one calendar day onto another day ("use Monday's roster
// for Tuesday"). Batch sibling of copyShiftToDateAction, modeled on
// duplicateWeekAction: copies land as drafts with no assignments, carry breaks
// + required skill, and a source shift is skipped when the target day already
// has a shift at the same (location, role, time-of-day). Respects the active
// location filter. Whole-day fixed-ms offset (UTC-calendar delta avoids DST
// distortion), matching duplicateWeekAction / moveShiftAction.
export async function copyDayToDateAction(formData: FormData): Promise<void> {
  const sourceDate = String(formData.get("sourceDate") ?? ""); // YYYY-MM-DD
  const targetDate = String(formData.get("targetDate") ?? ""); // YYYY-MM-DD
  const locationId = String(formData.get("location") ?? "");
  // Optional area scope: copy only this role's shifts (location + role = area).
  const role = String(formData.get("role") ?? "").trim();
  const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
  const tm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!sm || !tm) return;

  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(membership.role)) {
    throw new Error("Only admins can copy a day.");
  }
  const tenantId = membership.tenant.id;
  const me = await currentUser();

  // Source/target day windows in the same local frame the schedule page
  // buckets days in (local midnight → +1 day).
  const sourceStart = new Date(Number(sm[1]), Number(sm[2]) - 1, Number(sm[3]));
  const sourceEnd = new Date(sourceStart);
  sourceEnd.setDate(sourceEnd.getDate() + 1);
  const targetStart = new Date(Number(tm[1]), Number(tm[2]) - 1, Number(tm[3]));
  const targetEnd = new Date(targetStart);
  targetEnd.setDate(targetEnd.getDate() + 1);

  const deltaDays = Math.round(
    (Date.UTC(Number(tm[1]), Number(tm[2]) - 1, Number(tm[3])) -
      Date.UTC(Number(sm[1]), Number(sm[2]) - 1, Number(sm[3]))) /
      86_400_000,
  );
  if (deltaDays === 0) return; // copying a day onto itself is a no-op
  const offsetMs = deltaDays * 86_400_000;

  const sourceShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${sourceStart.toISOString()}::timestamptz`,
          sql`${scShifts.startsAt} < ${sourceEnd.toISOString()}::timestamptz`,
          locationId ? eq(scShifts.locationId, locationId) : undefined,
          role ? eq(scShifts.role, role) : undefined,
        ),
      ),
  );

  const destShifts = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.traceyTenantId, tenantId),
          sql`${scShifts.startsAt} >= ${targetStart.toISOString()}::timestamptz`,
          sql`${scShifts.startsAt} < ${targetEnd.toISOString()}::timestamptz`,
        ),
      ),
  );

  const destKeys = new Set<string>();
  for (const d of destShifts) {
    destKeys.add(`${d.locationId}|${d.role}|${d.startsAt.getTime()}`);
  }

  let copied = 0;
  let skipped = 0;
  const toInsert: Array<typeof scShifts.$inferInsert> = [];
  for (const s of sourceShifts) {
    const newStart = new Date(s.startsAt.getTime() + offsetMs);
    const newEnd = new Date(s.endsAt.getTime() + offsetMs);
    // Kati's rostering feedback #4 — skip any clone that lands in the past.
    if (hasStarted(newStart)) {
      skipped += 1;
      continue;
    }
    const key = `${s.locationId}|${s.role}|${newStart.getTime()}`;
    if (destKeys.has(key)) {
      skipped += 1;
      continue;
    }
    toInsert.push({
      traceyTenantId: tenantId,
      locationId: s.locationId,
      role: s.role,
      startsAt: newStart,
      endsAt: newEnd,
      status: "draft",
      notes: s.notes,
      breaks: s.breaks,
      breakPaidMinutes: s.breakPaidMinutes,
      breakUnpaidMinutes: s.breakUnpaidMinutes,
      requiredSkillId: s.requiredSkillId,
      createdByUserId: me?.id ?? null,
    });
    destKeys.add(key);
    copied += 1;
  }

  if (toInsert.length > 0) {
    await forTenant(tenantId).run((tx) => tx.insert(scShifts).values(toInsert));
  }

  await logAuditEvent({
    action: "shiftcraft.schedule.day_copied",
    targetKind: "sc_schedule_day",
    details: {
      from: sourceDate,
      to: targetDate,
      copied,
      skipped,
      locationFilter: locationId || null,
      roleFilter: role || null,
    },
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  const search = new URLSearchParams({
    week: targetDate,
    copied: String(copied),
    skipped: String(skipped),
  });
  if (locationId) search.set("location", locationId);
  redirect(`/app/schedule?${search.toString()}`);
}

// Email the accepted assignees of the given shifts that they're scheduled.
// Called when shifts are published — assignments made while a shift was still
// a draft are intentionally silent until then (see assignEmployeeAction).
// Build the in-app notification copy for a shift event.
function shiftInAppNotice(
  kind: "scheduled" | "offered",
  shift: { role: string; startsAt: Date; locationName: string | null },
): { title: string; body: string } {
  const when = shift.startsAt.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const where = shift.locationName ? ` at ${shift.locationName}` : "";
  if (kind === "offered") {
    return {
      title: `New shift offer: ${shift.role}`,
      body: `${when}${where} — open the app to accept or decline.`,
    };
  }
  return {
    title: `You're scheduled: ${shift.role}`,
    body: `${when}${where}.`,
  };
}

async function notifyAcceptedAssignees(tenantId: string, shiftIds: string[]) {
  if (shiftIds.length === 0) return;
  const channel = await getNotifyChannel(tenantId);
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        userId: scShiftAssignments.userId,
        email: users.email,
        name: users.name,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationName: scLocations.name,
      })
      .from(scShiftAssignments)
      .innerJoin(users, eq(users.id, scShiftAssignments.userId))
      .innerJoin(scShifts, eq(scShifts.id, scShiftAssignments.shiftId))
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          inArray(scShiftAssignments.shiftId, shiftIds),
          eq(scShiftAssignments.status, "accepted"),
        ),
      ),
  );
  const inApp: NotificationInput[] = [];
  for (const r of rows) {
    if (wantsEmail(channel) && r.email) {
      await notifyShiftScheduled({
        to: { email: r.email, name: r.name },
        shift: {
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          role: r.role,
          locationName: r.locationName,
        },
      });
    }
    if (wantsInApp(channel)) {
      const notice = shiftInAppNotice("scheduled", r);
      inApp.push({
        recipientUserId: r.userId,
        kind: "shiftcraft_shift_scheduled",
        title: notice.title,
        body: notice.body,
        actionUrl: "/app/my-shifts",
      });
    }
  }
  if (inApp.length > 0) await createNotifications(tenantId, inApp);
}

async function setShiftStatus(
  id: string,
  next: "draft" | "published" | "cancelled",
) {
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({
        status: next,
        updatedAt: new Date(),
        // Stamp the publish time so the schedule can tell an edited-since-
        // publish shift (updatedAt > publishedAt) from a clean published one.
        ...(next === "published" ? { publishedAt: new Date() } : {}),
      })
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  revalidatePath(`/app/schedule/${id}/edit`);
}

export async function publishShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setShiftStatus(id, "published");

  // AUDIT.md #10 — fetch the shift details for the webhook payload.
  // Pulled after the status flip so receivers see the published row.
  const tenant = await requireTenant();
  const [shift] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
      })
      .from(scShifts)
      .where(
        and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)),
      )
      .limit(1),
  );
  if (shift) {
    await emitWebhook(tenant.id, "shift.published", {
      shiftId: shift.id,
      locationId: shift.locationId,
      role: shift.role,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
    });
  }

  // Notify accepted assignees now that the shift is live.
  await notifyAcceptedAssignees(tenant.id, [id]);
}

export async function cancelShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await setShiftStatus(id, "cancelled");
}

// Returns {ok} rather than redirecting: the delete button lives inside the
// intercepted @modal route, and a server-side redirect() from there lands on a
// 404. The client button navigates back to /app/schedule itself instead.
export async function deleteShiftAction(
  id: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!id) return { ok: false, message: "Missing shift id." };
  const tenant = await requireTenant();
  // Kati's rostering feedback #7 — don't delete a shift that has already
  // started, or one in an approved-timesheet week. Both would erase a record
  // of work that happened / was signed off for pay.
  const [existing] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({ startsAt: scShifts.startsAt })
      .from(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)))
      .limit(1),
  );
  if (!existing) return { ok: false, message: "Shift not found." };
  if (hasStarted(existing.startsAt)) {
    return {
      ok: false,
      message: "That shift has already started — it can't be deleted.",
    };
  }
  const assignees = await forTenant(tenant.id).run((tx) =>
    tx
      .select({ userId: scShiftAssignments.userId })
      .from(scShiftAssignments)
      .where(
        and(
          eq(scShiftAssignments.shiftId, id),
          eq(scShiftAssignments.status, "accepted"),
        ),
      ),
  );
  if (
    await hasApprovedTimesheet(
      tenant.id,
      assignees.map((a) => a.userId),
      existing.startsAt,
    )
  ) {
    return {
      ok: false,
      message: "This shift's timesheet week is approved — reopen it first.",
    };
  }
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  return { ok: true };
}

export async function duplicateShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const weeks = Number(formData.get("weeks") ?? 1);
  if (!id) return;
  const tenant = await requireTenant();
  const user = await currentUser();
  const offsetMs = weeks * 7 * 24 * 60 * 60 * 1000;

  const [source] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)))
      .limit(1),
  );
  if (!source) return;

  // Kati's rostering feedback #4 — no copying into the past.
  if (hasStarted(new Date(source.startsAt.getTime() + offsetMs))) return;

  const [created] = await forTenant(tenant.id).run((tx) =>
    tx
      .insert(scShifts)
      .values({
        traceyTenantId: tenant.id,
        locationId: source.locationId,
        role: source.role,
        startsAt: new Date(source.startsAt.getTime() + offsetMs),
        endsAt: new Date(source.endsAt.getTime() + offsetMs),
        notes: source.notes,
        // Breaks + required skill are part of the shift's definition, so a
        // copy is only useful if it carries them too — otherwise the manager
        // re-enters every break on the duplicate.
        breaks: source.breaks,
        breakPaidMinutes: source.breakPaidMinutes,
        breakUnpaidMinutes: source.breakUnpaidMinutes,
        requiredSkillId: source.requiredSkillId,
        createdByUserId: user?.id ?? null,
      })
      .returning({ id: scShifts.id }),
  );

  revalidatePath("/app/schedule");
  if (created) redirect(`/app/schedule/${created.id}/edit`);
}

// Copy a single shift onto an arbitrary target date (the "Copy to…" picker on
// the shift editor). Unlike duplicateShiftAction's whole-week jump, the manager
// names the destination day directly — "copy today's shift to tomorrow" or to
// any future date. Time-of-day, duration, breaks and required skill all carry
// over; the copy lands as a draft with no assignments so it can be offered to
// whoever's free. Admin/scope rules match the rest of this file.
export async function copyShiftToDateAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const targetDate = String(formData.get("targetDate") ?? ""); // YYYY-MM-DD
  if (!id) return;
  // Accept only a plain calendar date; anything else is a no-op.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!m) return;

  const tenant = await requireTenant();
  const user = await currentUser();

  const [source] = await forTenant(tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id)))
      .limit(1),
  );
  if (!source) return;

  // AUDIT.md #13 — a scoped manager may only copy shifts at their locations.
  if (user) {
    const membership = await currentMembership();
    if (membership) {
      const scopeErr = await guardLocationScope(
        tenant.id,
        user.id,
        membership.role,
        source.locationId,
      );
      if (scopeErr) return;
    }
  }

  // Day delta from the source shift's calendar day to the target day. Both
  // sides use UTC calendar fields read in the same (server-local) frame the
  // editor renders dates in, so DST never distorts the count; the real
  // timestamps are then shifted by whole days, preserving time-of-day and
  // any overnight span exactly (same approach as moveShiftAction).
  const src = source.startsAt;
  const srcDayUtc = Date.UTC(
    src.getFullYear(),
    src.getMonth(),
    src.getDate(),
  );
  const targetDayUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const deltaDays = Math.round((targetDayUtc - srcDayUtc) / 86_400_000);
  const offsetMs = deltaDays * 86_400_000;

  // Kati's rostering feedback #4 — no copying onto a day/time already in the
  // past. The client also blocks past dates in the picker.
  if (hasStarted(new Date(source.startsAt.getTime() + offsetMs))) return;

  const [created] = await forTenant(tenant.id).run((tx) =>
    tx
      .insert(scShifts)
      .values({
        traceyTenantId: tenant.id,
        locationId: source.locationId,
        role: source.role,
        startsAt: new Date(source.startsAt.getTime() + offsetMs),
        endsAt: new Date(source.endsAt.getTime() + offsetMs),
        status: "draft",
        notes: source.notes,
        breaks: source.breaks,
        breakPaidMinutes: source.breakPaidMinutes,
        breakUnpaidMinutes: source.breakUnpaidMinutes,
        requiredSkillId: source.requiredSkillId,
        createdByUserId: user?.id ?? null,
      })
      .returning({ id: scShifts.id }),
  );

  await logAuditEvent({
    action: "shiftcraft.shift.copied_to_date",
    targetKind: "sc_shift",
    targetId: created?.id ?? null,
    details: {
      sourceShiftId: id,
      targetDate,
      deltaDays,
    },
  });

  revalidatePath("/app/schedule");
  if (created) redirect(`/app/schedule/${created.id}/edit`);
}

// Duplicate a shift in place — same day, same time, as a draft (carrying
// breaks + required skill, no assignments). Powers the "Copy" button on a
// shift chip in the area grid: the copy lands right next to the original so the
// manager can then drag it onto another day. Admin-only; scope-guarded. Returns
// {ok} like moveShiftAction (its drag-and-drop sibling) rather than redirecting,
// so the grid just refreshes in place.
export async function copyShiftInPlaceAction(
  shiftId: string,
  // Kati's rostering feedback #2.B — "Copy (keep person)": carry the source's
  // accepted assignees onto the copy. The copy lands at the same time so it
  // momentarily overlaps the original; that's expected — the manager drags it
  // onto another day next (the move preserves the assignment).
  carryAssignee = false,
): Promise<{ ok: boolean; message?: string; warning?: string }> {
  const membership = await requireAdminMembership();
  const user = await currentUser();

  const [source] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!source) return { ok: false, message: "Shift not found." };

  // AUDIT.md #13 — a scoped manager may only copy shifts at their locations.
  if (user) {
    const scopeErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      source.locationId,
    );
    if (scopeErr) return { ok: false, message: scopeErr.message };
  }

  // Kati's rostering feedback #4 — copy-in-place lands at the same time, so a
  // past shift would copy into the past. Refuse it.
  if (hasStarted(source.startsAt)) {
    return {
      ok: false,
      message: "That shift has already started — copy it to a future day instead.",
    };
  }

  let carriedCount = 0;
  await forTenant(membership.tenant.id).run(async (tx) => {
    const [created] = await tx
      .insert(scShifts)
      .values({
        traceyTenantId: membership.tenant.id,
        locationId: source.locationId,
        role: source.role,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        status: "draft",
        notes: source.notes,
        breaks: source.breaks,
        breakPaidMinutes: source.breakPaidMinutes,
        breakUnpaidMinutes: source.breakUnpaidMinutes,
        requiredSkillId: source.requiredSkillId,
        createdByUserId: user?.id ?? null,
      })
      .returning({ id: scShifts.id });
    if (carryAssignee && created) {
      const assignees = await tx
        .select({ userId: scShiftAssignments.userId })
        .from(scShiftAssignments)
        .where(
          and(
            eq(scShiftAssignments.shiftId, shiftId),
            eq(scShiftAssignments.status, "accepted"),
          ),
        );
      if (assignees.length > 0) {
        await tx.insert(scShiftAssignments).values(
          assignees.map((a) => ({
            shiftId: created.id,
            userId: a.userId,
            status: "accepted" as const,
            respondedAt: new Date(),
          })),
        );
        carriedCount = assignees.length;
      }
    }
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  // The copy lands at the SAME time as the original, so carrying the person
  // means they're now on two overlapping shifts. That's intended only as a
  // stepping stone to dragging the copy elsewhere — warn so it isn't left as
  // a silent double-booking.
  if (carriedCount > 0) {
    return {
      ok: true,
      warning:
        "Copied with the person — they're now on two shifts at this time. Drag the copy to another day to clear the double-booking.",
    };
  }
  return { ok: true };
}

// Copy a shift onto another day, offset by whole days, leaving the original in
// place. Powers drag-onto-a-past-date in the area grid: dropping a scheduled
// shift on a date before today duplicates it there (rather than moving it).
// The copy lands as an unassigned draft. Returns {ok} like moveShiftAction.
export async function copyShiftByDeltaAction(
  shiftId: string,
  deltaDays: number,
): Promise<{ ok: boolean; message?: string }> {
  if (!Number.isInteger(deltaDays) || deltaDays === 0) {
    return { ok: false, message: "No change." };
  }
  const membership = await requireAdminMembership();
  const user = await currentUser();

  const [source] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!source) return { ok: false, message: "Shift not found." };

  // AUDIT.md #13 — a scoped manager may only copy shifts at their locations.
  if (user) {
    const scopeErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      source.locationId,
    );
    if (scopeErr) return { ok: false, message: scopeErr.message };
  }

  const ms = deltaDays * 86_400_000;
  // Kati's rostering feedback #4 — dragging a shift onto a past day used to
  // copy it there; that produces past-dated rosters, so refuse it now.
  if (hasStarted(new Date(source.startsAt.getTime() + ms))) {
    return { ok: false, message: "Can't copy a shift into the past." };
  }
  await forTenant(membership.tenant.id).run((tx) =>
    tx.insert(scShifts).values({
      traceyTenantId: membership.tenant.id,
      locationId: source.locationId,
      role: source.role,
      startsAt: new Date(source.startsAt.getTime() + ms),
      endsAt: new Date(source.endsAt.getTime() + ms),
      status: "draft",
      notes: source.notes,
      breaks: source.breaks,
      breakPaidMinutes: source.breakPaidMinutes,
      breakUnpaidMinutes: source.breakUnpaidMinutes,
      requiredSkillId: source.requiredSkillId,
      createdByUserId: user?.id ?? null,
    }),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return { ok: true };
}

// Bulk-copy hand-picked shifts (multi-select in the area grid) onto a target
// day, a date range (every day in [from..to]), a week, or another area
// (location + role). Each copy lands as a draft — same as
// copyShiftInPlaceAction — so it shows in the unpublished/draft count. When
// carryAssignees is on, the source shift's accepted staff are copied onto each
// new shift. Inserts are batched.
const bulkCopyTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({
    kind: z.literal("dateRange"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    kind: z.literal("week"),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({ kind: z.literal("nextWeek") }),
  z.object({
    kind: z.literal("area"),
    locationId: z.string().uuid(),
    role: z.string().trim().min(1).max(80),
  }),
]);
const bulkCopySchema = z.object({
  shiftIds: z.array(z.string().uuid()).min(1).max(200),
  target: bulkCopyTargetSchema,
  carryAssignees: z.boolean().optional().default(false),
});

// Inclusive list of YYYY-MM-DD between two ISO dates (auto-swaps if reversed,
// capped to keep a fat-fingered range from inserting thousands of rows).
function eachDayIso(fromIso: string, toIso: string, cap = 92): string[] {
  let a = new Date(`${fromIso}T00:00:00`);
  let b = new Date(`${toIso}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return [];
  if (b < a) [a, b] = [b, a];
  const out: string[] = [];
  const cur = new Date(a);
  while (cur <= b && out.length < cap) {
    out.push(fmtIsoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export async function bulkCopyShiftsAction(input: {
  shiftIds: string[];
  target: BulkCopyTarget;
  carryAssignees?: boolean;
}): Promise<{ ok: boolean; copied: number; message?: string }> {
  const parsed = bulkCopySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, copied: 0, message: "Nothing to copy." };
  }
  const { shiftIds, target, carryAssignees } = parsed.data;

  const membership = await requireAdminMembership();
  const user = await currentUser();
  const tenantId = membership.tenant.id;

  const sources = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        breakPaidMinutes: scShifts.breakPaidMinutes,
        breakUnpaidMinutes: scShifts.breakUnpaidMinutes,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          inArray(scShifts.id, shiftIds),
          eq(scShifts.traceyTenantId, tenantId),
        ),
      ),
  );
  if (sources.length === 0) {
    return { ok: false, copied: 0, message: "No shifts found." };
  }

  // AUDIT.md #13 — a scoped manager may only touch their locations. Guard each
  // distinct source location, plus the destination when reassigning area.
  if (user) {
    const locationsToCheck = new Set<string | null>(
      sources.map((s) => s.locationId),
    );
    if (target.kind === "area") locationsToCheck.add(target.locationId);
    for (const loc of locationsToCheck) {
      const scopeErr = await guardLocationScope(
        tenantId,
        user.id,
        membership.role,
        loc,
      );
      if (scopeErr) return { ok: false, copied: 0, message: scopeErr.message };
    }
  }

  // A date range fans out into one "date" target per day; everything else is a
  // single target. Each (day-target × source) yields one copy.
  const dayTargets: BulkCopyTarget[] =
    target.kind === "dateRange"
      ? eachDayIso(target.from, target.to).map((d) => ({ kind: "date", date: d }))
      : [target];

  const rows: Array<typeof scShifts.$inferInsert> = [];
  const rowSourceIds: string[] = []; // parallel to rows, for carrying staff
  for (const dt of dayTargets) {
    for (const s of sources) {
      const resolved: BulkCopyResolved | null = resolveBulkCopyTarget(
        s,
        dt,
        startOfWeek(s.startsAt).getTime(),
      );
      // locationId is non-null on every shift; guard narrows the string|null
      // and defensively skips a malformed resolve.
      if (!resolved || !resolved.locationId) continue;
      rows.push({
        traceyTenantId: tenantId,
        locationId: resolved.locationId,
        role: resolved.role,
        startsAt: resolved.startsAt,
        endsAt: resolved.endsAt,
        status: "draft",
        notes: s.notes,
        breaks: s.breaks,
        breakPaidMinutes: s.breakPaidMinutes,
        breakUnpaidMinutes: s.breakUnpaidMinutes,
        requiredSkillId: s.requiredSkillId,
        createdByUserId: user?.id ?? null,
      });
      rowSourceIds.push(s.id);
    }
  }

  if (rows.length === 0) {
    return { ok: false, copied: 0, message: "Nothing to copy." };
  }

  // Accepted assignees per source shift (only when carrying staff forward).
  const assigneesBySource = new Map<string, string[]>();
  if (carryAssignees) {
    const assignmentRows = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          shiftId: scShiftAssignments.shiftId,
          userId: scShiftAssignments.userId,
        })
        .from(scShiftAssignments)
        .where(
          and(
            inArray(scShiftAssignments.shiftId, shiftIds),
            eq(scShiftAssignments.status, "accepted"),
          ),
        ),
    );
    for (const a of assignmentRows) {
      const arr = assigneesBySource.get(a.shiftId) ?? [];
      arr.push(a.userId);
      assigneesBySource.set(a.shiftId, arr);
    }
  }

  // RETURNING preserves VALUES order (single INSERT), so inserted[i] is the
  // copy of rowSourceIds[i] — same pattern repeatWeekAction uses to attach
  // carried assignments.
  const inserted = await forTenant(tenantId).run((tx) =>
    tx.insert(scShifts).values(rows).returning({ id: scShifts.id }),
  );

  if (carryAssignees && assigneesBySource.size > 0) {
    const assignInserts: Array<typeof scShiftAssignments.$inferInsert> = [];
    inserted.forEach((row, i) => {
      const sourceId = rowSourceIds[i];
      if (!sourceId) return;
      for (const userId of assigneesBySource.get(sourceId) ?? []) {
        assignInserts.push({
          shiftId: row.id,
          userId,
          status: "accepted",
          respondedAt: new Date(),
        });
      }
    });
    if (assignInserts.length > 0) {
      await forTenant(tenantId).run((tx) =>
        tx.insert(scShiftAssignments).values(assignInserts),
      );
    }
  }

  await logAuditEvent({
    action: "shiftcraft.schedule.bulk_copied",
    targetKind: "sc_schedule_bulk",
    details: {
      count: inserted.length,
      kind: target.kind,
      carriedAssignees: carryAssignees ?? false,
    },
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  revalidatePath("/app/coverage-gaps");
  return { ok: true, copied: inserted.length };
}

// ─── Assignments ───

async function requireAdminMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only admins can assign shifts.");
  }
  return m;
}

const assignSchema = z.object({
  shiftId: z.string().uuid(),
  userId: z.string().uuid("Pick an employee"),
});

export async function assignEmployeeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignSchema.safeParse({
    shiftId: formData.get("shiftId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please pick an employee.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireAdminMembership();

  // Fetch the shift up-front: needed for the leave-clash guard AND the
  // post-commit email payload. One query covers both.
  const [shiftRow] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        status: scShifts.status,
        locationName: scLocations.name,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.id, parsed.data.shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!shiftRow) {
    return { status: "error", message: "Shift not found." };
  }

  // Kati's rostering feedback #4 — can't change who's rostered on a shift that
  // has already started; that retroactively rewrites the roster/pay record.
  if (hasStarted(shiftRow.startsAt)) {
    return {
      status: "error",
      message: "That shift has already started — you can't change who's rostered on it.",
    };
  }

  // Roster-clash guard (AUDIT.md #6): if the worker has an approved
  // time-off request overlapping the shift window, refuse the assign —
  // unless the manager explicitly overrides ("assign anyway").
  const force = formData.get("force") === "on" || formData.get("force") === "1";
  const conflicts = await findApprovedLeaveOverlap(
    membership.tenant.id,
    parsed.data.userId,
    shiftRow.startsAt,
    shiftRow.endsAt,
  );
  if (conflicts.length > 0 && !force) {
    return {
      status: "error",
      message: `That employee is on ${fmtConflict(conflicts[0]!)}. Tick "assign anyway" to override.`,
      canOverride: true,
    };
  }
  if (conflicts.length > 0 && force) {
    await logAuditEvent({
      action: "shiftcraft.schedule.assign_override",
      targetKind: "sc_shift",
      targetId: parsed.data.shiftId,
      details: {
        userId: parsed.data.userId,
        conflict: fmtConflict(conflicts[0]!),
      },
    });
  }

  // Kati's rostering feedback #8 — double-booking guard: the same person
  // already has an accepted, overlapping shift in any area. Same override
  // affordance as the leave clash ("assign anyway").
  const overlap = await findOverlappingAssignment(
    membership.tenant.id,
    parsed.data.userId,
    shiftRow.startsAt,
    shiftRow.endsAt,
    parsed.data.shiftId,
  );
  if (overlap && !force) {
    return {
      status: "error",
      message: `Already rostered ${fmtShiftWindow(
        overlap.startsAt,
        overlap.endsAt,
        overlap.locationName,
      )} that day. Tick "assign anyway" to override.`,
      canOverride: true,
    };
  }
  if (overlap && force) {
    await logAuditEvent({
      action: "shiftcraft.schedule.assign_override",
      targetKind: "sc_shift",
      targetId: parsed.data.shiftId,
      details: {
        userId: parsed.data.userId,
        conflict: `double-booked ${fmtShiftWindow(
          overlap.startsAt,
          overlap.endsAt,
          overlap.locationName,
        )}`,
      },
    });
  }

  try {
    // Direct admin assignment is auto-approved — no employee accept/decline
    // step. Insert as 'accepted' with respondedAt stamped now so the shift
    // lands straight on the worker's roster (and in the employee schedule
    // view, which only renders accepted assignments).
    await forTenant(membership.tenant.id).run((tx) =>
      tx.insert(scShiftAssignments).values({
        shiftId: parsed.data.shiftId,
        userId: parsed.data.userId,
        status: "accepted",
        respondedAt: new Date(),
      }),
    );
  } catch (err) {
    // Unique index sc_shift_user_uq triggers on duplicate (shift, user).
    if (err instanceof Error && err.message.includes("sc_shift_user_uq")) {
      return {
        status: "error",
        message: "That employee is already assigned to this shift.",
      };
    }
    throw err;
  }

  // Email after commit — but ONLY for published shifts. Assigning someone to
  // a draft (e.g. dragging onto an unpublished slot) shouldn't notify them
  // yet; the email goes out when the schedule is published.
  if (shiftRow.status === "published") {
    const channel = await getNotifyChannel(membership.tenant.id);
    if (wantsEmail(channel)) {
      const [recipientRow] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, parsed.data.userId))
        .limit(1);
      if (recipientRow) {
        await notifyShiftScheduled({ to: recipientRow, shift: shiftRow });
      }
    }
    if (wantsInApp(channel)) {
      const notice = shiftInAppNotice("scheduled", shiftRow);
      await createNotifications(membership.tenant.id, [
        {
          recipientUserId: parsed.data.userId,
          kind: "shiftcraft_shift_scheduled",
          title: notice.title,
          body: notice.body,
          actionUrl: "/app/my-shifts",
        },
      ]);
    }
  }

  revalidatePath(`/app/schedule/${parsed.data.shiftId}/edit`);
  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return { status: "ok", message: "Scheduled." };
}

// Drag-and-drop assign: thin wrapper so the area grid can call the same
// auto-approve assign path with plain args (it has no <form>/FormData).
export async function assignEmployeeViaDnd(
  shiftId: string,
  userId: string,
): Promise<FormState & { warning?: string }> {
  const fd = new FormData();
  fd.set("shiftId", shiftId);
  fd.set("userId", userId);
  const res = await assignEmployeeAction({ status: "idle" }, fd);
  if (res.status === "error") return res;
  // Soft training-gap warning (items 4 & 7) — assignment already succeeded.
  const membership = await currentMembership();
  const warning = membership
    ? await trainingWarningForShift(membership.tenant.id, shiftId, userId)
    : null;
  return warning ? { ...res, warning } : res;
}

// Drag-and-drop create-and-assign (Kati's rostering feedback #2): dropping an
// employee onto an EMPTY day cell creates a draft shift in that area at a
// default 09:00–17:00 (a shift has no inherent time; the manager retimes it
// after) and assigns them. For an un-linked employee (no app login) we can't
// write an assignment row, so their name is parked in the shift note as a
// placeholder (#5) to be assigned for real once they're onboarded.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SHIFT_START_HOUR = 9;
const DEFAULT_SHIFT_END_HOUR = 17;

export async function createAndAssignViaDnd(
  dateIso: string,
  locationId: string,
  role: string,
  userId: string | null,
  placeholderName: string | null,
): Promise<{ ok: boolean; message?: string; warning?: string }> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) return { ok: false, message: "Invalid date." };
  if (!locationId) {
    return {
      ok: false,
      message: "This area has no location — add one before scheduling here.",
    };
  }
  const membership = await requireAdminMembership();
  const user = await currentUser();

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const startsAt = new Date(y, mo, d, DEFAULT_SHIFT_START_HOUR, 0, 0);
  const endsAt = new Date(y, mo, d, DEFAULT_SHIFT_END_HOUR, 0, 0);

  // Kati's rostering feedback #4 — no creating into the past.
  if (hasStarted(startsAt)) {
    return { ok: false, message: "Can't create a shift in the past." };
  }

  if (user) {
    const scopeErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      locationId,
    );
    if (scopeErr) return { ok: false, message: scopeErr.message };
  }

  // Kati's rostering feedback #8 — don't double-book a linked employee.
  if (userId) {
    const overlap = await findOverlappingAssignment(
      membership.tenant.id,
      userId,
      startsAt,
      endsAt,
      NIL_UUID,
    );
    if (overlap) {
      return {
        ok: false,
        message: `Already rostered ${fmtShiftWindow(
          overlap.startsAt,
          overlap.endsAt,
          overlap.locationName,
        )} that day.`,
      };
    }
  }

  await forTenant(membership.tenant.id).run(async (tx) => {
    const [created] = await tx
      .insert(scShifts)
      .values({
        traceyTenantId: membership.tenant.id,
        locationId,
        role,
        startsAt,
        endsAt,
        status: "draft",
        notes:
          !userId && placeholderName?.trim()
            ? `${placeholderName.trim()} (pending)`
            : null,
        createdByUserId: user?.id ?? null,
      })
      .returning({ id: scShifts.id });
    if (userId && created) {
      await tx.insert(scShiftAssignments).values({
        shiftId: created.id,
        userId,
        status: "accepted",
        respondedAt: new Date(),
      });
    }
  });

  // Soft training-gap warning (items 4 & 7) for the just-created area shift.
  const warning = userId
    ? fmtTrainingGap(
        await findAreaTrainingGap(membership.tenant.id, locationId, role, userId),
      )
    : null;

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return warning ? { ok: true, warning } : { ok: true };
}

// Double-booking guard for the MOVE paths. The assign paths already block an
// overlap (Kati #8), but moving an already-assigned shift onto a day/time where
// one of its accepted assignees is also rostered slipped through. Returns an
// error message if any accepted assignee would clash at the new window (their
// other shift, not this one), else null.
async function findMoveDoubleBook(
  tenantId: string,
  shiftId: string,
  newStart: Date,
  newEnd: Date,
): Promise<string | null> {
  const assignees = await forTenant(tenantId).run((tx) =>
    tx
      .select({ userId: scShiftAssignments.userId })
      .from(scShiftAssignments)
      .where(
        and(
          eq(scShiftAssignments.shiftId, shiftId),
          eq(scShiftAssignments.status, "accepted"),
        ),
      ),
  );
  for (const a of assignees) {
    const overlap = await findOverlappingAssignment(
      tenantId,
      a.userId,
      newStart,
      newEnd,
      shiftId, // exclude the shift being moved so it doesn't self-clash
    );
    if (overlap) {
      return `Can't move — that person is already rostered ${fmtShiftWindow(
        overlap.startsAt,
        overlap.endsAt,
        overlap.locationName,
      )} at this time.`;
    }
  }
  return null;
}

// Drag-and-drop move: shift a shift's window by a whole number of days,
// preserving its time-of-day and duration exactly (delta in days avoids any
// timezone reconstruction). Dropping 7 days forward in the 2-week grid is how
// "move to next week" works. Admin-only; scope-guarded on the shift's
// current location.
export async function moveShiftAction(
  shiftId: string,
  deltaDays: number,
): Promise<{ ok: boolean; message?: string }> {
  if (!Number.isInteger(deltaDays) || deltaDays === 0) {
    return { ok: false, message: "No change." };
  }
  const membership = await requireAdminMembership();
  const user = await currentUser();

  const [shiftRow] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationId: scShifts.locationId,
        status: scShifts.status,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!shiftRow) return { ok: false, message: "Shift not found." };

  // A shift that has already started can't be moved.
  if (hasStarted(shiftRow.startsAt)) {
    return {
      ok: false,
      message: "This shift has already started and can't be moved.",
    };
  }

  // AUDIT.md #13 — a scoped manager may only move shifts at their locations.
  if (user) {
    const scopeErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      shiftRow.locationId,
    );
    if (scopeErr) return { ok: false, message: scopeErr.message };
  }

  const ms = deltaDays * 86_400_000;
  const newStart = new Date(shiftRow.startsAt.getTime() + ms);
  const newEnd = new Date(shiftRow.endsAt.getTime() + ms);

  // Don't let a move land the shift's start in the past — e.g. dragging onto
  // today at an earlier hour that has already passed (07:00 when it's 09:00).
  // The day-cell drop guard only rejects whole past days; this catches the
  // today-but-earlier case at time granularity.
  if (hasStarted(newStart)) {
    return {
      ok: false,
      message: "Can't move a shift to a start time that's already passed.",
    };
  }

  const clash = await findMoveDoubleBook(
    membership.tenant.id,
    shiftId,
    newStart,
    newEnd,
  );
  if (clash) return { ok: false, message: clash };

  // Moving a shift un-publishes it: a published shift dragged to a new day
  // reverts to draft (its green dot goes back to draft) so the change must be
  // re-published before staff see it. Drafts/cancelled keep their status.
  const movedStatus = shiftRow.status === "published" ? "draft" : shiftRow.status;

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({
        startsAt: newStart,
        endsAt: newEnd,
        status: movedStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      ),
  );

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return { ok: true };
}

// Item 3: move a shift to a DIFFERENT area (location + role), optionally also
// shifting the day. Fired when a shift chip is dragged onto a cell in another
// area row. Mirrors moveShiftAction's guards (admin, not-started, location
// scope) but also reassigns locationId/role and allows deltaDays === 0 (a pure
// area change on the same day). The scoped-manager check runs against BOTH the
// source and destination location so a shift can't be moved out of / into a
// location the manager doesn't own.
const moveToAreaSchema = z.object({
  shiftId: z.string().uuid(),
  deltaDays: z.number().int(),
  locationId: z.string().uuid(),
  role: z.string().trim().min(1).max(80),
});

export async function moveShiftToAreaAction(input: {
  shiftId: string;
  deltaDays: number;
  locationId: string;
  role: string;
}): Promise<{ ok: boolean; message?: string; warning?: string }> {
  const parsed = moveToAreaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid move." };
  const { shiftId, deltaDays, locationId, role } = parsed.data;

  const membership = await requireAdminMembership();
  const user = await currentUser();

  const [shiftRow] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        locationId: scShifts.locationId,
        status: scShifts.status,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!shiftRow) return { ok: false, message: "Shift not found." };

  if (hasStarted(shiftRow.startsAt)) {
    return {
      ok: false,
      message: "This shift has already started and can't be moved.",
    };
  }

  // AUDIT.md #13 — a scoped manager may only move shifts between their own
  // locations. Check both source and destination.
  if (user) {
    const fromErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      shiftRow.locationId,
    );
    if (fromErr) return { ok: false, message: fromErr.message };
    const toErr = await guardLocationScope(
      membership.tenant.id,
      user.id,
      membership.role,
      locationId,
    );
    if (toErr) return { ok: false, message: toErr.message };
  }

  const ms = deltaDays * 86_400_000;
  const newStart = new Date(shiftRow.startsAt.getTime() + ms);
  const newEnd = new Date(shiftRow.endsAt.getTime() + ms);

  // Don't let a move land the shift's start in the past — e.g. dragging onto
  // today at an earlier hour that has already passed (07:00 when it's 09:00).
  // The day-cell drop guard only rejects whole past days; this catches the
  // today-but-earlier case at time granularity.
  if (hasStarted(newStart)) {
    return {
      ok: false,
      message: "Can't move a shift to a start time that's already passed.",
    };
  }

  const clash = await findMoveDoubleBook(
    membership.tenant.id,
    shiftId,
    newStart,
    newEnd,
  );
  if (clash) return { ok: false, message: clash };

  // Moving a shift (incl. across areas) un-publishes it — reverts a published
  // shift to draft so the change must be re-published before staff see it.
  const movedStatus = shiftRow.status === "published" ? "draft" : shiftRow.status;

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({
        startsAt: newStart,
        endsAt: newEnd,
        locationId,
        role,
        status: movedStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      ),
  );

  // Soft training-gap warning (items 4 & 7): flag the first accepted assignee
  // who isn't trained for the NEW area. Doesn't block the move.
  let warning: string | undefined;
  const assignees = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({ userId: scShiftAssignments.userId })
      .from(scShiftAssignments)
      .where(
        and(
          eq(scShiftAssignments.shiftId, shiftId),
          eq(scShiftAssignments.status, "accepted"),
        ),
      ),
  );
  for (const a of assignees) {
    const msg = fmtTrainingGap(
      await findAreaTrainingGap(membership.tenant.id, locationId, role, a.userId),
    );
    if (msg) {
      warning = msg;
      break;
    }
  }

  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  return warning ? { ok: true, warning } : { ok: true };
}

// Save an existing shift as a reusable template (item: "save the template so
// it can be used again"). Captures the shift's location, role, time-of-day and
// notes; the template then appears in the "From template" picker on
// /app/schedule/new. Admin-only, case-insensitive unique name per tenant.
const saveTemplateSchema = z.object({
  shiftId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the template a name").max(120),
});

export async function saveShiftAsTemplateAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = saveTemplateSchema.safeParse({
    shiftId: formData.get("shiftId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const membership = await requireAdminMembership();

  const [shiftRow] = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({
        locationId: scShifts.locationId,
        role: scShifts.role,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        notes: scShifts.notes,
        breaks: scShifts.breaks,
        requiredSkillId: scShifts.requiredSkillId,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, parsed.data.shiftId),
          eq(scShifts.traceyTenantId, membership.tenant.id),
        ),
      )
      .limit(1),
  );
  if (!shiftRow) return { status: "error", message: "Shift not found." };

  // Case-insensitive name uniqueness, matching createShiftTemplateAction.
  const dup = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .select({ id: scShiftTemplates.id })
      .from(scShiftTemplates)
      .where(
        and(
          eq(scShiftTemplates.traceyTenantId, membership.tenant.id),
          sql`lower(${scShiftTemplates.name}) = lower(${parsed.data.name})`,
        ),
      )
      .limit(1),
  );
  if (dup.length > 0) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { name: ["A template with this name already exists."] },
    };
  }

  await forTenant(membership.tenant.id).run((tx) =>
    tx.insert(scShiftTemplates).values({
      traceyTenantId: membership.tenant.id,
      name: parsed.data.name,
      locationId: shiftRow.locationId,
      role: shiftRow.role,
      startHour: shiftRow.startsAt.getHours(),
      startMinute: shiftRow.startsAt.getMinutes(),
      endHour: shiftRow.endsAt.getHours(),
      endMinute: shiftRow.endsAt.getMinutes(),
      defaultNotes: shiftRow.notes,
      defaultBreaks: shiftRow.breaks,
      requiredSkillId: shiftRow.requiredSkillId,
    }),
  );
  revalidatePath("/app/shift-templates");
  revalidatePath("/app/schedule/new");
  return { status: "ok", message: `Saved template "${parsed.data.name}".` };
}

/**
 * Bulk-offer one shift to every linked employee — either all of them
 * or those in a chosen department. "Linked" means sc_employees rows
 * with a non-null app_user_id (contractor rows without an auth
 * account can't accept anyway).
 *
 * - Skips users already on the shift (any status).
 * - Skips users who've opted out of "offers" emails (the assignment
 *   row is still inserted; only the email is suppressed). This
 *   mirrors how 1:1 assign works once they're back in the app.
 * - Resilient to partial failure: one bad email send doesn't block
 *   the rest — safeSend() inside notifyShiftOffered swallows hiccups.
 *
 * Bound to a <form>, so returns void; the page revalidates and the
 * caller's edit page reloads with the new assignment list. A flash
 * banner reads `?offered=N&skipped=M` after the redirect.
 */
const bulkOfferSchema = z.object({
  shiftId: z.string().uuid("Pick a shift"),
  // Empty string = "everyone in the tenant". A UUID = "this department".
  departmentId: z.string().optional().or(z.literal("")),
});

export async function bulkOfferShiftAction(formData: FormData): Promise<void> {
  const parsed = bulkOfferSchema.safeParse({
    shiftId: formData.get("shiftId"),
    departmentId: formData.get("departmentId") ?? "",
  });
  if (!parsed.success) return;
  const membership = await requireAdminMembership();
  const tenantId = membership.tenant.id;

  // Validate the shift exists in this tenant + capture details for the
  // email payload. Doing this BEFORE the candidate query catches the
  // common "wrong-shift-id form replay" case cheaply.
  const [shift] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShifts.id,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        locationName: scLocations.name,
      })
      .from(scShifts)
      .leftJoin(scLocations, eq(scLocations.id, scShifts.locationId))
      .where(
        and(
          eq(scShifts.id, parsed.data.shiftId),
          eq(scShifts.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!shift) return;

  // Candidates: linked employees, optionally scoped by department.
  const deptId = parsed.data.departmentId?.trim();
  const candidateRows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        appUserId: scEmployees.appUserId,
        departmentName: scDepartments.name,
      })
      .from(scEmployees)
      .leftJoin(
        scDepartments,
        eq(scDepartments.id, scEmployees.departmentId),
      )
      .where(
        and(
          eq(scEmployees.traceyTenantId, tenantId),
          sql`${scEmployees.appUserId} is not null`,
          deptId ? eq(scEmployees.departmentId, deptId) : undefined,
        ),
      ),
  );
  const rawCandidateIds = Array.from(
    new Set(
      candidateRows
        .map((r) => r.appUserId)
        .filter((v): v is string => !!v),
    ),
  );

  // Roster-clash guard (AUDIT.md #6): drop candidates with overlapping
  // approved leave. They surface in the action's `skipped` counter so
  // the admin sees that workers were excluded for a reason.
  const conflictingCandidates = await findUsersWithLeaveConflict(
    tenantId,
    rawCandidateIds,
    shift.startsAt,
    shift.endsAt,
  );
  const candidateIds = rawCandidateIds.filter(
    (uid) => !conflictingCandidates.has(uid),
  );
  const skippedDueToLeave = conflictingCandidates.size;

  if (candidateIds.length === 0) {
    await logAuditEvent({
      action: "shiftcraft.shift.bulk_offered",
      targetKind: "sc_shift",
      targetId: shift.id,
      details: {
        departmentId: deptId || null,
        offered: 0,
        skipped: 0,
        skippedDueToLeave,
        candidates: rawCandidateIds.length,
      },
    });
    revalidatePath(`/app/schedule/${shift.id}/edit`);
    redirect(
      `/app/schedule/${shift.id}/edit?offered=0&skipped=${skippedDueToLeave}&leave=${skippedDueToLeave}`,
    );
  }

  // Insert one row per candidate with onConflictDoNothing so re-offers
  // (race or repeat clicks) collapse cleanly against sc_shift_user_uq.
  let offered = 0;
  let skipped = 0;
  await forTenant(tenantId).run(async (tx) => {
    for (const uid of candidateIds) {
      const result = await tx
        .insert(scShiftAssignments)
        .values({ shiftId: shift.id, userId: uid })
        .onConflictDoNothing()
        .returning({ id: scShiftAssignments.id });
      if (result.length > 0) offered += 1;
      else skipped += 1;
    }
  });

  // Email the offer to anyone newly added who hasn't opted out.
  if (offered > 0) {
    const channel = await getNotifyChannel(tenantId);
    const newlyOfferedIds = new Set<string>();
    // Re-derive newly-offered by another pass: we tracked count above
    // but not which ids. Pull them in one query.
    const newly = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          userId: scShiftAssignments.userId,
        })
        .from(scShiftAssignments)
        .where(
          and(
            eq(scShiftAssignments.shiftId, shift.id),
            eq(scShiftAssignments.status, "offered"),
            sql`${scShiftAssignments.userId} = ANY(${candidateIds})`,
          ),
        ),
    );
    for (const r of newly) newlyOfferedIds.add(r.userId);

    if (wantsEmail(channel)) {
      const unsubscribed = await getUnsubscribedUserIds(tenantId, "offers");
      const recipientRows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
        })
        .from(users)
        .where(sql`${users.id} = ANY(${Array.from(newlyOfferedIds)})`);

      for (const r of recipientRows) {
        if (unsubscribed.has(r.id)) continue;
        await notifyShiftOffered({
          to: { email: r.email, name: r.name },
          shift,
        });
      }
    }

    if (wantsInApp(channel) && newlyOfferedIds.size > 0) {
      const notice = shiftInAppNotice("offered", shift);
      await createNotifications(
        tenantId,
        Array.from(newlyOfferedIds).map((uid) => ({
          recipientUserId: uid,
          kind: "shiftcraft_shift_offered",
          title: notice.title,
          body: notice.body,
          actionUrl: "/app/my-shifts",
        })),
      );
    }
  }

  await logAuditEvent({
    action: "shiftcraft.shift.bulk_offered",
    targetKind: "sc_shift",
    targetId: shift.id,
    details: {
      departmentId: deptId || null,
      offered,
      skipped,
      skippedDueToLeave,
      candidates: rawCandidateIds.length,
    },
  });

  revalidatePath(`/app/schedule/${shift.id}/edit`);
  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
  redirect(
    `/app/schedule/${shift.id}/edit?offered=${offered}&skipped=${skipped}&leave=${skippedDueToLeave}`,
  );
}

export async function unassignAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!id) return;
  const membership = await requireAdminMembership();
  await forTenant(membership.tenant.id).run((tx) =>
    tx.delete(scShiftAssignments).where(eq(scShiftAssignments.id, id)),
  );
  if (shiftId) revalidatePath(`/app/schedule/${shiftId}/edit`);
  revalidatePath("/app/schedule");
  revalidatePath("/app/my-shifts");
}

async function respondToOffer(
  assignmentId: string,
  next: "accepted" | "declined",
) {
  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  const user = await requireUser();
  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShiftAssignments)
      .set({ status: next, respondedAt: new Date() })
      .where(
        and(
          eq(scShiftAssignments.id, assignmentId),
          eq(scShiftAssignments.userId, user.id),
          eq(scShiftAssignments.status, "offered"),
        ),
      ),
  );
  revalidatePath("/app/my-shifts");
  revalidatePath("/app/schedule");
}

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await respondToOffer(id, "accepted");
}

export async function declineOfferAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await respondToOffer(id, "declined");
}
