"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import {
  forTenant,
  scTimesheetApprovals,
  scTimesheetDayApprovals,
} from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { addDays, fmtIsoDate, parseIsoDate, startOfWeek } from "~/lib/clock";
import { isAtLeastManager } from "~/lib/roles";
import { emitWebhook } from "~/lib/webhooks";

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

  // AUDIT.md #10 — outbound webhook. Fire-and-forget; emit swallows
  // receiver failures so a broken integration doesn't block approval.
  await emitWebhook(g.tenantId, "timesheet.approved", {
    weekStart: weekStartIso,
    employeeUserId: g.payload.employeeUserId,
    approvedByUserId: g.me,
    notes,
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

  // Webhook fan-out for each approval. Receivers see N events with
  // the same weekStart but distinct employeeUserIds, mirroring the
  // single-approve action's contract.
  for (const userId of g.employeeUserIds) {
    await emitWebhook(g.tenantId, "timesheet.approved", {
      weekStart: weekStartIso,
      employeeUserId: userId,
      approvedByUserId: g.me,
      bulk: true,
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
  const reason = String(formData.get("reason") ?? "").trim();

  // AUDIT.md #4 — when the existing state is "approved", treat this as
  // a REOPEN: require a non-empty reason and write a distinct audit
  // event. For "disputed" (or no row) we keep the old reset semantics
  // — no reason required.
  const [existing] = await forTenant(g.tenantId).run((tx) =>
    tx
      .select({ status: scTimesheetApprovals.status })
      .from(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, g.tenantId),
          eq(scTimesheetApprovals.employeeUserId, g.payload.employeeUserId),
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      )
      .limit(1),
  );
  const wasApproved = existing?.status === "approved";
  if (wasApproved && reason.length === 0) {
    console.warn(
      "[clearTimesheetApprovalAction] reopen of approved week requires a reason",
    );
    return;
  }

  const weekEndIso = fmtIsoDate(addDays(g.payload.weekStart, 7));
  await forTenant(g.tenantId).run(async (tx) => {
    await tx
      .delete(scTimesheetApprovals)
      .where(
        and(
          eq(scTimesheetApprovals.traceyTenantId, g.tenantId),
          eq(scTimesheetApprovals.employeeUserId, g.payload.employeeUserId),
          // weekStart is a date column; an ISO string compares cleanly.
          sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
        ),
      );
    // Reopening a week also clears every per-day sign-off for it, so the
    // grid resets to fully pending rather than leaving stale day rows that
    // would re-roll the week back to approved on the next per-day touch.
    await tx
      .delete(scTimesheetDayApprovals)
      .where(
        and(
          eq(scTimesheetDayApprovals.traceyTenantId, g.tenantId),
          eq(scTimesheetDayApprovals.employeeUserId, g.payload.employeeUserId),
          sql`${scTimesheetDayApprovals.workDate} >= ${weekStartIso}::date`,
          sql`${scTimesheetDayApprovals.workDate} < ${weekEndIso}::date`,
        ),
      );
  });

  await logAuditEvent({
    action: wasApproved
      ? "shiftcraft.timesheet.reopened"
      : "shiftcraft.timesheet.dispute_cleared",
    targetKind: "sc_timesheet_approval",
    targetId: g.payload.employeeUserId,
    details: {
      employeeUserId: g.payload.employeeUserId,
      weekStart: weekStartIso,
      previousStatus: existing?.status ?? null,
      reason: wasApproved ? reason : null,
    },
  });

  revalidatePath("/app/timesheets");
}

// ─── Per-day approvals ───
//
// Finer-grained sign-off: a manager approves / disputes / clears a single
// work date. The week-level table above stays the source of truth for every
// downstream consumer (Xero, schedule lock, leave balances, dashboard, CSV
// export, digest, punch-edit lock); these actions roll their per-day state up
// into it. The client passes `completedDays` — the ISO dates whose shifts are
// complete (worked + clocked out, not in the future) for that employee-week,
// straight off the rendered grid — so the rollup knows the denominator without
// re-aggregating the clock stream here.
//
// Materialise-on-touch: the first per-day change to a week that was approved /
// disputed at the week level expands that week status into explicit day rows
// for every completed day, so one diverging day (e.g. disputing Tuesday on an
// approved week) doesn't drag the others with it via inheritance.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCompletedDays(formData: FormData): string[] {
  return String(formData.get("completedDays") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ISO_DATE.test(s));
}

async function gateAndParseDay(
  formData: FormData,
): Promise<
  | {
      ok: true;
      tenantId: string;
      me: string;
      employeeUserId: string;
      workDateIso: string;
      weekStartIso: string;
      weekEndIso: string;
      completedDays: string[];
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

  const employeeUserId = String(formData.get("employeeUserId") ?? "").trim();
  const workRaw = String(formData.get("workDate") ?? "").trim();
  if (!employeeUserId) return { ok: false, message: "Missing employee." };
  const workDate = parseIsoDate(workRaw);
  if (!workDate) return { ok: false, message: "Invalid date." };
  const weekStart = startOfWeek(workDate);
  return {
    ok: true,
    tenantId: m.tenant.id,
    me: me.id,
    employeeUserId,
    workDateIso: fmtIsoDate(workDate),
    weekStartIso: fmtIsoDate(weekStart),
    weekEndIso: fmtIsoDate(addDays(weekStart, 7)),
    completedDays: parseCompletedDays(formData),
  };
}

// Expand a week-level status into explicit day rows for every completed day
// that doesn't already have one, so subsequent per-day edits are independent.
async function materializeWeekIntoDays(
  tx: Parameters<Parameters<ReturnType<typeof forTenant>["run"]>[0]>[0],
  tenantId: string,
  employeeUserId: string,
  weekStartIso: string,
  weekEndIso: string,
  completedDays: string[],
  actingUserId: string,
): Promise<void> {
  if (completedDays.length === 0) return;
  const [weekRow] = await tx
    .select({
      status: scTimesheetApprovals.status,
      notes: scTimesheetApprovals.notes,
    })
    .from(scTimesheetApprovals)
    .where(
      and(
        eq(scTimesheetApprovals.traceyTenantId, tenantId),
        eq(scTimesheetApprovals.employeeUserId, employeeUserId),
        sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
      ),
    )
    .limit(1);
  if (!weekRow) return;
  const existing = await tx
    .select({ workDate: scTimesheetDayApprovals.workDate })
    .from(scTimesheetDayApprovals)
    .where(
      and(
        eq(scTimesheetDayApprovals.traceyTenantId, tenantId),
        eq(scTimesheetDayApprovals.employeeUserId, employeeUserId),
        sql`${scTimesheetDayApprovals.workDate} >= ${weekStartIso}::date`,
        sql`${scTimesheetDayApprovals.workDate} < ${weekEndIso}::date`,
      ),
    );
  const have = new Set(existing.map((r) => r.workDate));
  for (const d of completedDays) {
    if (have.has(d)) continue;
    await tx
      .insert(scTimesheetDayApprovals)
      .values({
        traceyTenantId: tenantId,
        employeeUserId,
        workDate: d,
        status: weekRow.status,
        notes: weekRow.notes,
        approvedByUserId: actingUserId,
      })
      .onConflictDoNothing();
  }
}

// Recompute the week-level rollup from the per-day rows: any completed day
// disputed → week disputed; every completed day approved → week approved;
// otherwise the week row is removed (pending). Returns the resulting status.
async function rollupWeekFromDays(
  tx: Parameters<Parameters<ReturnType<typeof forTenant>["run"]>[0]>[0],
  tenantId: string,
  employeeUserId: string,
  weekStartIso: string,
  weekEndIso: string,
  completedDays: string[],
  actingUserId: string,
): Promise<"approved" | "disputed" | null> {
  const dayRows = await tx
    .select({
      workDate: scTimesheetDayApprovals.workDate,
      status: scTimesheetDayApprovals.status,
      notes: scTimesheetDayApprovals.notes,
    })
    .from(scTimesheetDayApprovals)
    .where(
      and(
        eq(scTimesheetDayApprovals.traceyTenantId, tenantId),
        eq(scTimesheetDayApprovals.employeeUserId, employeeUserId),
        sql`${scTimesheetDayApprovals.workDate} >= ${weekStartIso}::date`,
        sql`${scTimesheetDayApprovals.workDate} < ${weekEndIso}::date`,
      ),
    );
  const byDate = new Map(dayRows.map((r) => [r.workDate, r]));
  const disputedNote = completedDays
    .map((d) => byDate.get(d))
    .find((r) => r?.status === "disputed")?.notes;
  const anyDisputed = completedDays.some(
    (d) => byDate.get(d)?.status === "disputed",
  );
  const allApproved =
    completedDays.length > 0 &&
    completedDays.every((d) => byDate.get(d)?.status === "approved");

  if (anyDisputed) {
    await upsertApproval(
      tx,
      tenantId,
      employeeUserId,
      weekStartIso,
      "disputed",
      actingUserId,
      disputedNote ?? "Flagged by manager — please review punches.",
    );
    return "disputed";
  }
  if (allApproved) {
    await upsertApproval(
      tx,
      tenantId,
      employeeUserId,
      weekStartIso,
      "approved",
      actingUserId,
      null,
    );
    return "approved";
  }
  await tx
    .delete(scTimesheetApprovals)
    .where(
      and(
        eq(scTimesheetApprovals.traceyTenantId, tenantId),
        eq(scTimesheetApprovals.employeeUserId, employeeUserId),
        sql`${scTimesheetApprovals.weekStart} = ${weekStartIso}::date`,
      ),
    );
  return null;
}

async function runDayAction(
  g: Extract<Awaited<ReturnType<typeof gateAndParseDay>>, { ok: true }>,
  change:
    | { status: "approved" | "disputed"; notes: string | null }
    | { clear: true },
): Promise<"approved" | "disputed" | null> {
  return forTenant(g.tenantId).run(async (tx) => {
    await materializeWeekIntoDays(
      tx,
      g.tenantId,
      g.employeeUserId,
      g.weekStartIso,
      g.weekEndIso,
      g.completedDays,
      g.me,
    );
    if ("clear" in change) {
      await tx
        .delete(scTimesheetDayApprovals)
        .where(
          and(
            eq(scTimesheetDayApprovals.traceyTenantId, g.tenantId),
            eq(scTimesheetDayApprovals.employeeUserId, g.employeeUserId),
            sql`${scTimesheetDayApprovals.workDate} = ${g.workDateIso}::date`,
          ),
        );
    } else {
      await tx
        .insert(scTimesheetDayApprovals)
        .values({
          traceyTenantId: g.tenantId,
          employeeUserId: g.employeeUserId,
          workDate: g.workDateIso,
          status: change.status,
          notes: change.notes,
          approvedByUserId: g.me,
        })
        .onConflictDoUpdate({
          target: [
            scTimesheetDayApprovals.traceyTenantId,
            scTimesheetDayApprovals.employeeUserId,
            scTimesheetDayApprovals.workDate,
          ],
          set: {
            status: change.status,
            notes: change.notes,
            approvedByUserId: g.me,
            approvedAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
    return rollupWeekFromDays(
      tx,
      g.tenantId,
      g.employeeUserId,
      g.weekStartIso,
      g.weekEndIso,
      g.completedDays,
      g.me,
    );
  });
}

export async function approveDayAction(formData: FormData): Promise<void> {
  const g = await gateAndParseDay(formData);
  if (!g.ok) {
    console.warn("[approveDayAction] refused:", g.message);
    return;
  }
  const weekStatus = await runDayAction(g, { status: "approved", notes: null });
  await logAuditEvent({
    action: "shiftcraft.timesheet.day_approved",
    targetKind: "sc_timesheet_day_approval",
    targetId: `${g.employeeUserId}:${g.workDateIso}`,
    details: {
      employeeUserId: g.employeeUserId,
      workDate: g.workDateIso,
      weekStart: g.weekStartIso,
      weekStatus,
    },
  });
  if (weekStatus === "approved") {
    await emitWebhook(g.tenantId, "timesheet.approved", {
      weekStart: g.weekStartIso,
      employeeUserId: g.employeeUserId,
      approvedByUserId: g.me,
    });
  }
  revalidatePath("/app/timesheets");
}

export async function disputeDayAction(formData: FormData): Promise<void> {
  const g = await gateAndParseDay(formData);
  if (!g.ok) {
    console.warn("[disputeDayAction] refused:", g.message);
    return;
  }
  const notes =
    String(formData.get("notes") ?? "").trim().slice(0, 1000) ||
    "Flagged by manager — please review this day's punches.";
  const weekStatus = await runDayAction(g, { status: "disputed", notes });
  await logAuditEvent({
    action: "shiftcraft.timesheet.day_disputed",
    targetKind: "sc_timesheet_day_approval",
    targetId: `${g.employeeUserId}:${g.workDateIso}`,
    details: {
      employeeUserId: g.employeeUserId,
      workDate: g.workDateIso,
      weekStart: g.weekStartIso,
      notes,
      weekStatus,
    },
  });
  revalidatePath("/app/timesheets");
}

export async function clearDayApprovalAction(formData: FormData): Promise<void> {
  const g = await gateAndParseDay(formData);
  if (!g.ok) {
    console.warn("[clearDayApprovalAction] refused:", g.message);
    return;
  }
  const weekStatus = await runDayAction(g, { clear: true });
  await logAuditEvent({
    action: "shiftcraft.timesheet.day_cleared",
    targetKind: "sc_timesheet_day_approval",
    targetId: `${g.employeeUserId}:${g.workDateIso}`,
    details: {
      employeeUserId: g.employeeUserId,
      workDate: g.workDateIso,
      weekStart: g.weekStartIso,
      weekStatus,
    },
  });
  revalidatePath("/app/timesheets");
}
