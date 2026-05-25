"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { forTenant, scShiftAssignments, scShifts } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { notifyTenantAdmins } from "~/lib/notifications";
import { findApprovedLeaveOverlap } from "~/lib/time-off-impact";

/**
 * Claim an open shift. Validates that the shift is published, hasn't
 * started, and has no existing accepted assignment. If those hold,
 * inserts an `accepted` assignment row for the calling user — a single
 * write, no separate "offer" round-trip.
 *
 * Returns void so the form action can be bound directly to <form action>.
 * On any guard failure we log + bail; the page revalidate brings the
 * user back with a fresh roster so the bad shift simply drops out.
 */
export async function claimShiftAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const membership = await currentMembership();
  if (!membership) return;
  const tenantId = membership.tenant.id;

  const shiftId = String(formData.get("shiftId") ?? "");
  if (!shiftId) return;

  // Concurrency note: two users can race here. The unique index
  // sc_shift_user_uq on (shift_id, user_id) prevents the SAME user from
  // double-claiming, and the post-insert verification below would
  // detect another user beating us to it. Doing both in a single
  // transaction keeps the window tight.
  let didClaim = false;
  let captured: { role: string; startsAt: Date; locationName: string | null } | null =
    null;

  await forTenant(tenantId).run(async (tx) => {
    const [shift] = await tx
      .select({
        id: scShifts.id,
        status: scShifts.status,
        startsAt: scShifts.startsAt,
        endsAt: scShifts.endsAt,
        role: scShifts.role,
        // Accepted count via correlated subquery — same shape as the
        // open-shifts page query, which keeps the two consistent.
        acceptedCount: sql<number>`(
          SELECT count(*)::int FROM ${scShiftAssignments}
          WHERE ${scShiftAssignments.shiftId} = ${scShifts.id}
            AND ${scShiftAssignments.status} = 'accepted'
        )`,
      })
      .from(scShifts)
      .where(
        and(
          eq(scShifts.id, shiftId),
          eq(scShifts.traceyTenantId, tenantId),
        ),
      )
      .limit(1);
    if (!shift) return;
    if (shift.status !== "published") return;
    if (shift.startsAt.getTime() <= Date.now()) return;
    if (shift.acceptedCount > 0) return;

    // Roster-clash guard (AUDIT.md #6): refuse if the worker is on
    // approved leave overlapping this shift. The open-shifts page
    // SHOULD already filter these out, but a stale-cache claim or a
    // direct POST should still no-op rather than create a contradiction.
    const conflicts = await findApprovedLeaveOverlap(
      tenantId,
      user.id,
      shift.startsAt,
      shift.endsAt,
    );
    if (conflicts.length > 0) return;

    // Insert + tolerate the unique-index hit if the same user already
    // claimed (e.g. double-click). onConflictDoNothing keeps the action
    // idempotent without a separate precheck.
    await tx
      .insert(scShiftAssignments)
      .values({
        shiftId,
        userId: user.id,
        status: "accepted",
        respondedAt: new Date(),
      })
      .onConflictDoNothing();

    didClaim = true;
    captured = {
      role: shift.role,
      startsAt: shift.startsAt,
      locationName: null,
    };
  });

  if (!didClaim || !captured) return;
  // Type assertion needed because TS narrows `captured` to never inside
  // the unreachable branches of the conditional above.
  const claimed = captured as {
    role: string;
    startsAt: Date;
    locationName: string | null;
  };

  await logAuditEvent({
    action: "shiftcraft.shift.claimed",
    targetKind: "sc_shift",
    targetId: shiftId,
    details: {
      role: claimed.role,
      startsAt: claimed.startsAt.toISOString(),
    },
  });

  // Tell the admins someone picked it up. Excluding the actor is
  // automatic via the helper's options arg — but here the actor is an
  // employee, who likely isn't an admin. Pass excludeUserId anyway so
  // owner-claiming-their-own-open-shift doesn't ping themselves.
  await notifyTenantAdmins(
    tenantId,
    {
      kind: "shiftcraft_shift_claimed",
      title: "Open shift claimed",
      body: `${user.name ?? user.email} claimed the ${claimed.role} shift on ${claimed.startsAt.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`,
      actionUrl: "/app/schedule",
    },
    { excludeUserId: user.id },
  );

  revalidatePath("/app/open-shifts");
  revalidatePath("/app/coverage-gaps");
  revalidatePath("/app/my-shifts");
  revalidatePath("/app/schedule");
}
