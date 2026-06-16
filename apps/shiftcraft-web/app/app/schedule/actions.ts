"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  users,
  type ShiftBreak,
} from "@tracey/db";
import { currentMembership, currentUser, requireUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { notifyShiftOffered, notifyShiftScheduled } from "~/lib/email";
import { getUnsubscribedUserIds } from "~/lib/email-prefs";
import {
  findApprovedLeaveOverlap,
  findUsersWithLeaveConflict,
} from "~/lib/time-off-impact";
import { emitWebhook } from "~/lib/webhooks";
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

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

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
  if (!weekStart || !weekEnd) return;

  // Admin-only: surface the same error message as single-shift publish.
  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (membership.role !== "admin" && membership.role !== "owner") {
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
    eq(scShifts.status, "draft"),
    sql`${scShifts.startsAt} >= ${startsAtIso}::timestamptz`,
    sql`${scShifts.startsAt} < ${endsAtIso}::timestamptz`,
  ];
  if (locationId) conditions.push(eq(scShifts.locationId, locationId));

  // Capture the IDs of the shifts that will flip so we can fan out
  // webhooks afterwards. RETURNING on the same UPDATE keeps the round
  // trip count at one.
  const published = await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: "published", updatedAt: new Date() })
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
  if (membership.role !== "admin" && membership.role !== "owner") {
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
  const sm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceDate);
  const tm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!sm || !tm) return;

  const membership = await currentMembership();
  if (!membership) throw new Error("You must belong to a workspace.");
  if (membership.role !== "admin" && membership.role !== "owner") {
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
async function notifyAcceptedAssignees(tenantId: string, shiftIds: string[]) {
  if (shiftIds.length === 0) return;
  const rows = await forTenant(tenantId).run((tx) =>
    tx
      .select({
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
  for (const r of rows) {
    if (!r.email) continue;
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
}

async function setShiftStatus(
  id: string,
  next: "draft" | "published" | "cancelled",
) {
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ status: next, updatedAt: new Date() })
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

export async function deleteShiftAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tenant = await requireTenant();
  await forTenant(tenant.id).run((tx) =>
    tx
      .delete(scShifts)
      .where(and(eq(scShifts.id, id), eq(scShifts.traceyTenantId, tenant.id))),
  );
  revalidatePath("/app/schedule");
  redirect("/app/schedule");
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

// ─── Assignments ───

async function requireAdminMembership() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (m.role !== "admin" && m.role !== "owner") {
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

  // Roster-clash guard (AUDIT.md #6): if the worker has an approved
  // time-off request overlapping the shift window, refuse the assign.
  const conflicts = await findApprovedLeaveOverlap(
    membership.tenant.id,
    parsed.data.userId,
    shiftRow.startsAt,
    shiftRow.endsAt,
  );
  if (conflicts.length > 0) {
    return {
      status: "error",
      message: `Can't assign — that employee is on ${fmtConflict(conflicts[0]!)}.`,
    };
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
    const [recipientRow] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, parsed.data.userId))
      .limit(1);
    if (recipientRow) {
      await notifyShiftScheduled({ to: recipientRow, shift: shiftRow });
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
): Promise<FormState> {
  const fd = new FormData();
  fd.set("shiftId", shiftId);
  fd.set("userId", userId);
  return assignEmployeeAction({ status: "idle" }, fd);
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

  await forTenant(membership.tenant.id).run((tx) =>
    tx
      .update(scShifts)
      .set({ startsAt: newStart, endsAt: newEnd, updatedAt: new Date() })
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
    const unsubscribed = await getUnsubscribedUserIds(tenantId, "offers");
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
