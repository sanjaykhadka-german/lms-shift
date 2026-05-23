"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { forTenant, scTimesheetApprovals } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { fmtIsoDate, parseIsoDate, startOfWeek } from "~/lib/clock";
import { isAtLeastManager } from "~/lib/roles";

// The actions below are bound straight to <form action={...}>, so they
// must return Promise<void>. Errors are logged server-side and the page
// is revalidated either way — the table renders the latest state on the
// next render. If a future caller needs structured results (e.g. an
// optimistic-UI client component), it can wrap these with its own
// useActionState-shaped return.

function parseWeekStartOrError(raw: string | null): Date | string {
  const parsed = parseIsoDate(raw);
  if (!parsed) return "Invalid week.";
  const aligned = startOfWeek(parsed);
  if (aligned.getTime() !== parsed.getTime()) {
    // Snap to Monday so the row's key is canonical even if a caller
    // sends a mid-week date.
    return aligned;
  }
  return aligned;
}

interface BasePayload {
  employeeUserId: string;
  weekStart: Date;
}

async function gateAndParse(
  formData: FormData,
): Promise<{ ok: true; tenantId: string; me: string; payload: BasePayload } | { ok: false; message: string }> {
  const m = await currentMembership();
  if (!m) return { ok: false, message: "Not signed in." };
  if (!isAtLeastManager(m.role)) {
    return { ok: false, message: "Only managers can change approval state." };
  }
  const me = await currentUser();
  if (!me) return { ok: false, message: "Not signed in." };

  const employeeUserId = String(formData.get("employeeUserId") ?? "").trim();
  const weekRaw = String(formData.get("weekStart") ?? "");
  if (!employeeUserId) return { ok: false, message: "Missing employee." };
  const weekParsed = parseWeekStartOrError(weekRaw);
  if (typeof weekParsed === "string") {
    return { ok: false, message: weekParsed };
  }
  return {
    ok: true,
    tenantId: m.tenant.id,
    me: me.id,
    payload: { employeeUserId, weekStart: weekParsed },
  };
}

// Shared upsert primitive — same shape for single and bulk actions.
// Caller is responsible for being inside a forTenant().run() tx.
async function upsertApproval(
  tx: Parameters<Parameters<ReturnType<typeof forTenant>["run"]>[0]>[0],
  tenantId: string,
  employeeUserId: string,
  weekStartIso: string,
  status: "approved" | "disputed",
  approvedByUserId: string,
  notes: string | null,
): Promise<void> {
  await tx
    .insert(scTimesheetApprovals)
    .values({
      traceyTenantId: tenantId,
      employeeUserId,
      weekStart: weekStartIso,
      status,
      approvedByUserId,
      notes,
    })
    .onConflictDoUpdate({
      target: [
        scTimesheetApprovals.traceyTenantId,
        scTimesheetApprovals.employeeUserId,
        scTimesheetApprovals.weekStart,
      ],
      set: {
        status,
        approvedByUserId,
        approvedAt: new Date(),
        notes,
        updatedAt: new Date(),
      },
    });
}

export async function approveTimesheetAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[approveTimesheetAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);
  // Optional manager note carried alongside approval — surfaced via the
  // detail panel's textarea. Falls back to null so an approval without a
  // typed note clears any previously-stored dispute reason.
  const notes =
    String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;

  await forTenant(g.tenantId).run((tx) =>
    upsertApproval(
      tx,
      g.tenantId,
      g.payload.employeeUserId,
      weekStartIso,
      "approved",
      g.me,
      notes,
    ),
  );

  await logAuditEvent({
    action: "shiftcraft.timesheet.approved",
    targetKind: "sc_timesheet_approval",
    targetId: `${g.payload.employeeUserId}:${weekStartIso}`,
    details: {
      weekStart: weekStartIso,
      employeeUserId: g.payload.employeeUserId,
      notes,
    },
  });

  revalidatePath("/app/timesheets");
}

export async function disputeTimesheetAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[disputeTimesheetAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);
  const notes =
    String(formData.get("notes") ?? "").trim().slice(0, 1000) || null;

  await forTenant(g.tenantId).run((tx) =>
    upsertApproval(
      tx,
      g.tenantId,
      g.payload.employeeUserId,
      weekStartIso,
      "disputed",
      g.me,
      notes,
    ),
  );

  await logAuditEvent({
    action: "shiftcraft.timesheet.disputed",
    targetKind: "sc_timesheet_approval",
    targetId: `${g.payload.employeeUserId}:${weekStartIso}`,
    details: {
      weekStart: weekStartIso,
      employeeUserId: g.payload.employeeUserId,
      notes,
    },
  });

  revalidatePath("/app/timesheets");
}

// ─── Bulk approve / dispute ───
//
// Manager+ flips status for many (employee, week) rows at once. FormData
// shape:
//   - weekStart: single ISO date string
//   - userId:    repeated (one per checkbox in the bulk form)
//
// All upserts happen inside a single forTenant().run() tx so a failure
// rolls back the whole batch rather than leaving the table half-updated.
// One audit row per user — easier to grep than a single multi-target event.

async function gateAndParseBulk(
  formData: FormData,
): Promise<
  | {
      ok: true;
      tenantId: string;
      me: string;
      weekStart: Date;
      employeeUserIds: string[];
    }
  | { ok: false; message: string }
> {
  const m = await currentMembership();
  if (!m) return { ok: false, message: "Not signed in." };
  if (!isAtLeastManager(m.role)) {
    return { ok: false, message: "Only managers can change approval state." };
  }
  const me = await currentUser();
  if (!me) return { ok: false, message: "Not signed in." };

  const weekRaw = String(formData.get("weekStart") ?? "");
  const weekParsed = parseWeekStartOrError(weekRaw);
  if (typeof weekParsed === "string") {
    return { ok: false, message: weekParsed };
  }
  const employeeUserIds = formData
    .getAll("userId")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);
  if (employeeUserIds.length === 0) {
    return { ok: false, message: "No employees selected." };
  }
  return {
    ok: true,
    tenantId: m.tenant.id,
    me: me.id,
    weekStart: weekParsed,
    employeeUserIds,
  };
}

export async function bulkApproveAction(formData: FormData): Promise<void> {
  const g = await gateAndParseBulk(formData);
  if (!g.ok) {
    console.warn("[bulkApproveAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.weekStart);

  await forTenant(g.tenantId).run(async (tx) => {
    for (const userId of g.employeeUserIds) {
      await upsertApproval(
        tx,
        g.tenantId,
        userId,
        weekStartIso,
        "approved",
        g.me,
        null,
      );
    }
  });

  for (const userId of g.employeeUserIds) {
    await logAuditEvent({
      action: "shiftcraft.timesheet.approved",
      targetKind: "sc_timesheet_approval",
      targetId: `${userId}:${weekStartIso}`,
      details: { weekStart: weekStartIso, employeeUserId: userId, bulk: true },
    });
  }

  revalidatePath("/app/timesheets");
}

export async function bulkDisputeAction(formData: FormData): Promise<void> {
  const g = await gateAndParseBulk(formData);
  if (!g.ok) {
    console.warn("[bulkDisputeAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.weekStart);
  const notes =
    String(formData.get("notes") ?? "").trim().slice(0, 1000) ||
    "Flagged in bulk — please review punches.";

  await forTenant(g.tenantId).run(async (tx) => {
    for (const userId of g.employeeUserIds) {
      await upsertApproval(
        tx,
        g.tenantId,
        userId,
        weekStartIso,
        "disputed",
        g.me,
        notes,
      );
    }
  });

  for (const userId of g.employeeUserIds) {
    await logAuditEvent({
      action: "shiftcraft.timesheet.disputed",
      targetKind: "sc_timesheet_approval",
      targetId: `${userId}:${weekStartIso}`,
      details: {
        weekStart: weekStartIso,
        employeeUserId: userId,
        notes,
        bulk: true,
      },
    });
  }

  revalidatePath("/app/timesheets");
}

export async function clearTimesheetApprovalAction(
  formData: FormData,
): Promise<void> {
  const g = await gateAndParse(formData);
  if (!g.ok) {
    console.warn("[clearTimesheetApprovalAction] refused:", g.message);
    return;
  }
  const weekStartIso = fmtIsoDate(g.payload.weekStart);

  await forTenant(g.tenantId).run((tx) =>
    tx
      .delete(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, g.tenantId),
          eq(scTimesheetApprovals.employeeUserId, g.payload.employeeUserId),
          // weekStart is a date column; an ISO string compares cleanly.
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      ),
  );

  revalidatePath("/app/timesheets");
}
