"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  forTenant,
  scEmployees,
  scLeaveTypes,
  scTimeOffRequests,
  scTimesheetApprovals,
  scXeroEarningsMapping,
  scXeroEmployeeLinks,
  scXeroLeaveMapping,
  scXeroPayRuns,
  type ScPayrollCategory,
} from "@tracey/db";
import { currentMembership, requireUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import {
  addDays,
  fmtIsoDate,
  getEventsInRangeForTenant,
  parseIsoDate,
  startOfWeek,
} from "~/lib/clock";
import { deriveSegments, splitSegmentByDay } from "~/lib/clock";
import { getHolidaysForTenant } from "~/lib/holidays";
import {
  _parseAwardProfile,
  classifyEmployeeWeek,
  mergeAwardProfiles,
} from "~/lib/timesheet-classifier";
import { getTenantAwardProfile } from "~/lib/award-profile";
import {
  buildCategoryUnitsFromBreakdown,
  findMissingMappings,
} from "~/lib/payroll/categories";
import {
  fetchPayRunSummary,
  isXeroConfigured,
  listPayCalendars,
  listXeroEmployees,
  loadConnection,
  pushLeaveApplications,
  pushTimesheets,
  type XeroLeaveApplicationInput,
  type XeroTimesheetInput,
} from "~/lib/payroll/xero";
import { deriveXeroIdempotencyKey } from "~/lib/payroll/idempotency";

export type FormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

async function requireManager() {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers and admins can export timesheets.");
  }
  return m;
}

// ─── Export a week's approved timesheets to Xero (AUDIT.md #5) ──────
//
// 1. Validate the week + connection + earnings mappings.
// 2. For every employee with clock activity that week, classify
//    minutes into category buckets.
// 3. Cross-reference the (tenant, employee) → xero_employee_id link.
//    Skip unlinked employees with a warning rather than failing the
//    whole export.
// 4. Push one Xero Timesheet per employee with per-category lines.
// 5. Record a sc_xero_pay_runs row (status='submitted') keyed on
//    (tenant, week_start). Re-exporting the same week reuses the
//    existing row + re-pushes — receivers see one timesheet per
//    employee per week regardless.

const exportSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function exportToXeroAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isXeroConfigured()) {
    return { status: "error", message: "Xero is not configured." };
  }
  const parsed = exportSchema.safeParse({
    weekStart: formData.get("weekStart"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Pick a valid week." };
  }
  const membership = await requireManager();
  const user = await requireUser();
  const tenantId = membership.tenant.id;

  const weekStartParsed = parseIsoDate(parsed.data.weekStart);
  if (!weekStartParsed) {
    return { status: "error", message: "Pick a valid week." };
  }
  const weekStart = startOfWeek(weekStartParsed);
  const weekEnd = addDays(weekStart, 7);
  const weekStartIso = fmtIsoDate(weekStart);
  const weekEndIso = fmtIsoDate(addDays(weekStart, 6));

  const connection = await loadConnection(tenantId);
  if (!connection) {
    return {
      status: "error",
      message: "Connect Xero first via /app/admin/payroll.",
    };
  }

  // Pre-flight: the org must have at least one pay calendar. Without one no
  // employee is payable and Xero rejects every timesheet, so fail fast with a
  // single actionable message rather than pushing a doomed run.
  let payCalendars: Awaited<ReturnType<typeof listPayCalendars>>;
  try {
    payCalendars = await listPayCalendars(tenantId);
  } catch (err) {
    return {
      status: "error",
      message: `Couldn't read Xero pay calendars: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
  if (payCalendars.length === 0) {
    return {
      status: "error",
      message:
        "No pay calendar found in the connected Xero org. Create a pay calendar in Xero Payroll before exporting.",
    };
  }

  // Earnings-rate map (category → xero rate id) and employee links.
  const [mappingRows, linkRows, employeeRows] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroEarningsMapping)
        .where(eq(scXeroEarningsMapping.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroEmployeeLinks)
        .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          appUserId: scEmployees.appUserId,
          fullName: scEmployees.fullName,
          payType: scEmployees.payType,
          awardProfile: scEmployees.awardProfile,
        })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            isNotNull(scEmployees.appUserId),
          ),
        ),
    ),
  ]);
  if (linkRows.length === 0) {
    return {
      status: "error",
      message:
        "No employees are linked to Xero yet. Link them at /app/admin/payroll first.",
    };
  }
  const mapping = new Map<ScPayrollCategory, string>(
    mappingRows.map((m) => [m.category as ScPayrollCategory, m.xeroEarningsRateId]),
  );
  // Categories the tenant has actually mapped — drives the opt-in
  // OT-on-penalty split in buildCategoryUnitsFromBreakdown. A *_ot combo
  // is only emitted when it's mapped; otherwise that OT folds into the
  // base penalty bucket (legacy behaviour).
  const mappedCategorySet = new Set<ScPayrollCategory>(mapping.keys());
  // Link by sc_employees.id, then derive appUserId → xeroEmployeeId
  // via the employee row.
  const linkByEmpId = new Map(linkRows.map((l) => [l.scEmployeeId, l]));
  const xeroEmployeeByAppUser = new Map<string, string>();
  for (const emp of employeeRows) {
    const link = linkByEmpId.get(emp.id);
    if (link && emp.appUserId) {
      xeroEmployeeByAppUser.set(emp.appUserId, link.xeroEmployeeId);
    }
  }

  // Pay calendar per linked Xero employee. A linked employee with no calendar
  // in Xero can't receive a timesheet, so we skip them (with a reason) rather
  // than letting Xero reject the whole batch.
  let xeroEmployees: Awaited<ReturnType<typeof listXeroEmployees>>;
  try {
    xeroEmployees = await listXeroEmployees(tenantId);
  } catch (err) {
    return {
      status: "error",
      message: `Couldn't read Xero employees: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }
  const calendarByXeroEmp = new Map<string, string | null>(
    xeroEmployees.map((e) => [e.id, e.payrollCalendarId]),
  );

  // Pull every clock event in the window once and group per user.
  const events = await getEventsInRangeForTenant(tenantId, weekStart, weekEnd);
  const byUser = new Map<string, typeof events>();
  for (const e of events) {
    const arr = byUser.get(e.appUserId) ?? [];
    arr.push(e);
    byUser.set(e.appUserId, arr);
  }

  // Tenant profile for the classifier; holidays scoped to the week.
  const [holidayRows, awardProfile] = await Promise.all([
    getHolidaysForTenant(tenantId, weekStartIso, weekEndIso),
    getTenantAwardProfile(tenantId),
  ]);
  const holidaySet = new Set(holidayRows.map((h) => h.date));

  // Walk per user; bail at the first unmapped category so the admin
  // gets a single actionable error rather than a partial export.
  const timesheets: XeroTimesheetInput[] = [];
  const skipped: string[] = [];
  const allUsedCategories = new Set<ScPayrollCategory>();

  for (const emp of employeeRows) {
    if (!emp.appUserId) continue;
    const userEvents = byUser.get(emp.appUserId) ?? [];
    if (userEvents.length === 0) continue;

    // Salaried staff (Slice 1): worked hours are recorded/rostered in
    // ShiftCraft but NOT pushed to Xero — their fixed Salary line pays them,
    // so pushing hourly timesheet hours would double-pay. Reported in the
    // export summary so the skip is transparent, not silent.
    if (emp.payType === "salaried") {
      skipped.push(`${emp.fullName} (salaried — paid by fixed salary in Xero)`);
      continue;
    }

    // Compute per-day worked-ms from clock segments. Same logic the
    // /app/timesheets page uses; duplicating it here keeps the export
    // independent of that page's rendering.
    const segs = deriveSegments(userEvents, weekEnd);
    const perDayMs = Array.from({ length: 7 }, () => 0);
    for (const s of segs) {
      if (s.kind !== "work") continue;
      for (const chunk of splitSegmentByDay(s)) {
        const dayIdx = Math.floor(
          (chunk.startedAt.getTime() - weekStart.getTime()) / 86_400_000,
        );
        if (dayIdx >= 0 && dayIdx < 7) {
          perDayMs[dayIdx]! += chunk.endedAt.getTime() - chunk.startedAt.getTime();
        }
      }
    }
    if (perDayMs.every((ms) => ms === 0)) continue;

    // Resolution chain mirrors the /app/timesheets page: employee profile →
    // tenant profile → @tracey/award defaults, merged per leaf field. Without
    // the per-employee merge the export silently re-classified everyone on the
    // tenant/default thresholds, ignoring per-employee award overrides.
    const effectiveProfile = mergeAwardProfiles(
      awardProfile,
      _parseAwardProfile(emp.awardProfile),
    );
    const breakdown = classifyEmployeeWeek(
      weekStart,
      perDayMs,
      holidaySet,
      effectiveProfile.thresholds,
    );
    const categoryUnits = buildCategoryUnitsFromBreakdown(
      breakdown,
      mappedCategorySet,
    );
    if (categoryUnits.size === 0) continue;

    // Employee linking check.
    const xeroEmpId = xeroEmployeeByAppUser.get(emp.appUserId);
    if (!xeroEmpId) {
      skipped.push(`${emp.fullName} (no Xero link)`);
      continue;
    }

    // Pay-calendar check: Xero AU attaches the timesheet via the employee's
    // pay calendar. No calendar on the Xero record → the push would be
    // rejected, so skip with a clear reason.
    if (!calendarByXeroEmp.get(xeroEmpId)) {
      skipped.push(`${emp.fullName} (no pay calendar in Xero)`);
      continue;
    }

    const lines = [];
    for (const [cat, unitsByDay] of categoryUnits) {
      allUsedCategories.add(cat);
      const rateId = mapping.get(cat);
      if (!rateId) continue; // missing check is below; per-line skip safe
      lines.push({ earningsRateId: rateId, unitsByDay });
    }
    if (lines.length === 0) continue;

    timesheets.push({
      xeroEmployeeId: xeroEmpId,
      startDate: weekStartIso,
      endDate: weekEndIso,
      lines,
    });
  }

  // Categories used across all employees, validated against the
  // tenant's mapping. Fail-fast if any are missing — the export is
  // either valid for all employees or for none.
  const missing = findMissingMappings(allUsedCategories, mapping);
  if (missing.length > 0) {
    return {
      status: "error",
      message: `Missing Xero earnings rate mapping for: ${missing.join(", ")}. Map them at /app/admin/payroll first.`,
    };
  }

  if (timesheets.length === 0) {
    return {
      status: "error",
      message:
        skipped.length > 0
          ? `Nothing to export. Skipped: ${skipped.join(", ")}.`
          : "No clock activity to export this week.",
    };
  }

  // Idempotency: derive the key from (tenant, week, payload) so re-clicking
  // the button with unchanged data reuses the same key — Xero dedupes and we
  // don't create duplicate timesheets / double-pay. Re-exporting after
  // correcting hours changes the payload hash, yielding a fresh key. See
  // lib/payroll/idempotency.ts (kept pure so it's unit-testable).
  const idempotencyKey = deriveXeroIdempotencyKey(
    tenantId,
    weekStartIso,
    timesheets,
  );

  let pushError: string | null = null;
  let pushed: Awaited<ReturnType<typeof pushTimesheets>> = [];
  try {
    pushed = await pushTimesheets(tenantId, timesheets, idempotencyKey);
  } catch (err) {
    pushError = err instanceof Error ? err.message : "Xero push failed";
  }

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scXeroPayRuns)
      .values({
        traceyTenantId: tenantId,
        weekStart: weekStartIso,
        status: pushError ? "failed" : "submitted",
        submittedByUserId: user.id,
        lastError: pushError,
        summary: {
          timesheets: pushed,
          skipped,
          idempotencyKey,
        },
      })
      .onConflictDoUpdate({
        target: [scXeroPayRuns.traceyTenantId, scXeroPayRuns.weekStart],
        set: {
          status: pushError ? "failed" : "submitted",
          submittedByUserId: user.id,
          submittedAt: new Date(),
          lastError: pushError,
          summary: {
            timesheets: pushed,
            skipped,
            idempotencyKey,
          },
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: pushError
      ? "shiftcraft.xero.export_failed"
      : "shiftcraft.xero.export_submitted",
    targetKind: "sc_xero_pay_run",
    details: {
      weekStart: weekStartIso,
      timesheetsAttempted: timesheets.length,
      skipped: skipped.length,
      error: pushError,
    },
  });

  revalidatePath("/app/timesheets");
  revalidatePath("/app/admin/payroll");

  if (pushError) {
    return {
      status: "error",
      message: `Xero rejected the export: ${pushError}`,
    };
  }
  const skippedNote = skipped.length > 0 ? ` Skipped: ${skipped.join(", ")}.` : "";
  return {
    status: "ok",
    message: `Pushed ${timesheets.length} timesheet${timesheets.length === 1 ? "" : "s"} to Xero.${skippedNote}`,
  };
}

// ─── Approve the week's timesheets + export, in one click (Slice 3) ──
//
// Convenience combo for "I've reviewed this week — sign it off and push it".
// Approves every employee with clock activity that week whose timesheet is
// still PENDING (rows already 'disputed' are left alone so a deliberate
// dispute isn't steamrolled), then delegates to exportToXeroAction for the
// actual push. Approval is independent of export here — the export pushes
// hours either way — but doing both in one action keeps the payroll close.
export async function approveWeekAndExportAction(
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isXeroConfigured()) {
    return { status: "error", message: "Xero is not configured." };
  }
  const parsed = exportSchema.safeParse({
    weekStart: formData.get("weekStart"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Pick a valid week." };
  }
  const membership = await requireManager();
  const user = await requireUser();
  const tenantId = membership.tenant.id;

  const weekStartParsed = parseIsoDate(parsed.data.weekStart);
  if (!weekStartParsed) {
    return { status: "error", message: "Pick a valid week." };
  }
  const weekStart = startOfWeek(weekStartParsed);
  const weekEnd = addDays(weekStart, 7);
  const weekStartIso = fmtIsoDate(weekStart);

  // Who has clock activity this week → the set worth approving.
  const events = await getEventsInRangeForTenant(tenantId, weekStart, weekEnd);
  const activeUserIds = [...new Set(events.map((e) => e.appUserId))];

  let approved = 0;
  if (activeUserIds.length > 0) {
    const existing = await forTenant(tenantId).run((tx) =>
      tx
        .select({
          employeeUserId: scTimesheetApprovals.employeeUserId,
          status: scTimesheetApprovals.status,
        })
        .from(scTimesheetApprovals)
        .where(
          and(
            eq(scTimesheetApprovals.traceyTenantId, tenantId),
            eq(scTimesheetApprovals.weekStart, weekStartIso),
          ),
        ),
    );
    const statusByUser = new Map(
      existing.map((a) => [a.employeeUserId, a.status]),
    );
    for (const uid of activeUserIds) {
      const st = statusByUser.get(uid);
      // Skip already-approved (no-op) and disputed (respect the dispute).
      if (st === "approved" || st === "disputed") continue;
      await forTenant(tenantId).run((tx) =>
        tx
          .insert(scTimesheetApprovals)
          .values({
            traceyTenantId: tenantId,
            employeeUserId: uid,
            weekStart: weekStartIso,
            status: "approved",
            approvedByUserId: user.id,
            notes: null,
          })
          .onConflictDoUpdate({
            target: [
              scTimesheetApprovals.traceyTenantId,
              scTimesheetApprovals.employeeUserId,
              scTimesheetApprovals.weekStart,
            ],
            set: {
              status: "approved",
              approvedByUserId: user.id,
              approvedAt: new Date(),
              notes: null,
              updatedAt: new Date(),
            },
          }),
      );
      approved += 1;
    }
  }

  await logAuditEvent({
    action: "shiftcraft.timesheet.week_approved_bulk",
    targetKind: "sc_timesheet_approval",
    details: { weekStart: weekStartIso, approved },
  });

  // Delegate the push to the canonical export action, then fold the
  // approval count into the message.
  const result = await exportToXeroAction(prev, formData);
  const approvedNote = `Approved ${approved} timesheet${approved === 1 ? "" : "s"}. `;
  if (result.status === "error") {
    // Approvals already committed; surface them alongside the export error.
    return {
      status: "error",
      message: `${approvedNote}${result.message}`,
    };
  }
  if (result.status === "ok") {
    return { status: "ok", message: `${approvedNote}${result.message}` };
  }
  return result;
}

// ─── Read-back of a finalised Xero pay run ──────────────────────────
//
// Admin pastes the Xero PayRunID they want to pull totals from. We
// fetch the summary + persist into the existing sc_xero_pay_runs row
// for that week, flipping status to 'finalised'. Reports surface this
// when present.
//
// One row per week, so the admin needs to be on the right week; we
// reject if the week_start doesn't match a row.

// ─── Push approved leave to Xero (Slice 2) ─────────────────────────
//
// Sends approved ShiftCraft time-off in a date range to Xero as Payroll-AU
// Leave Applications. Mirrors the timesheet export:
//   1. Validate range + connection + leave-type mappings.
//   2. Find approved time-off overlapping the range that hasn't been pushed
//      (xero_leave_application_id IS NULL), for employees linked to Xero with
//      a mapped leave type. Skip the rest with a reason.
//   3. Create one Xero Leave Application per request (leavePeriods omitted →
//      Xero auto-calculates units) and persist the returned id back onto the
//      request so re-runs never duplicate.
// Remaining-leave then updates in Xero and surfaces via the existing balance
// read-back (fetchAnnualLeaveBalances / Team-leave overview).

const leavePushSchema = z.object({
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function pushApprovedLeaveAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isXeroConfigured()) {
    return { status: "error", message: "Xero is not configured." };
  }
  const parsed = leavePushSchema.safeParse({
    rangeStart: formData.get("rangeStart"),
    rangeEnd: formData.get("rangeEnd"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Pick a valid date range." };
  }
  if (parsed.data.rangeEnd < parsed.data.rangeStart) {
    return { status: "error", message: "End date must be on or after start." };
  }
  const membership = await requireManager();
  const user = await requireUser();
  const tenantId = membership.tenant.id;

  const connection = await loadConnection(tenantId);
  if (!connection) {
    return {
      status: "error",
      message: "Connect Xero first via /app/admin/payroll.",
    };
  }

  const [leaveMapRows, linkRows, employeeRows, requests] = await Promise.all([
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroLeaveMapping)
        .where(eq(scXeroLeaveMapping.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select()
        .from(scXeroEmployeeLinks)
        .where(eq(scXeroEmployeeLinks.traceyTenantId, tenantId)),
    ),
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scEmployees.id,
          appUserId: scEmployees.appUserId,
          fullName: scEmployees.fullName,
        })
        .from(scEmployees)
        .where(
          and(
            eq(scEmployees.traceyTenantId, tenantId),
            isNotNull(scEmployees.appUserId),
          ),
        ),
    ),
    // Approved, not-yet-pushed time-off overlapping the range.
    forTenant(tenantId).run((tx) =>
      tx
        .select({
          id: scTimeOffRequests.id,
          userId: scTimeOffRequests.userId,
          leaveTypeId: scTimeOffRequests.leaveTypeId,
          startDate: scTimeOffRequests.startDate,
          endDate: scTimeOffRequests.endDate,
          leaveTypeName: scLeaveTypes.name,
        })
        .from(scTimeOffRequests)
        .leftJoin(
          scLeaveTypes,
          eq(scLeaveTypes.id, scTimeOffRequests.leaveTypeId),
        )
        .where(
          and(
            eq(scTimeOffRequests.traceyTenantId, tenantId),
            eq(scTimeOffRequests.status, "approved"),
            isNull(scTimeOffRequests.xeroLeaveApplicationId),
            lte(scTimeOffRequests.startDate, parsed.data.rangeEnd),
            gte(scTimeOffRequests.endDate, parsed.data.rangeStart),
          ),
        ),
    ),
  ]);

  if (leaveMapRows.length === 0) {
    return {
      status: "error",
      message:
        "No leave types are mapped to Xero yet. Map them at /app/admin/payroll first.",
    };
  }
  if (requests.length === 0) {
    return {
      status: "ok",
      message: "No approved leave to push in that range.",
    };
  }

  const xeroLeaveTypeByScType = new Map(
    leaveMapRows.map((m) => [m.scLeaveTypeId, m.xeroLeaveTypeId]),
  );
  const linkByEmpId = new Map(linkRows.map((l) => [l.scEmployeeId, l]));
  const xeroEmployeeByAppUser = new Map<string, string>();
  const nameByAppUser = new Map<string, string>();
  for (const emp of employeeRows) {
    if (!emp.appUserId) continue;
    nameByAppUser.set(emp.appUserId, emp.fullName);
    const link = linkByEmpId.get(emp.id);
    if (link) xeroEmployeeByAppUser.set(emp.appUserId, link.xeroEmployeeId);
  }

  const inputs: XeroLeaveApplicationInput[] = [];
  const skipped: string[] = [];
  for (const r of requests) {
    const who = nameByAppUser.get(r.userId) ?? "Unknown employee";
    const xeroEmpId = xeroEmployeeByAppUser.get(r.userId);
    if (!xeroEmpId) {
      skipped.push(`${who} (no Xero link)`);
      continue;
    }
    const xeroLeaveTypeId = r.leaveTypeId
      ? xeroLeaveTypeByScType.get(r.leaveTypeId)
      : undefined;
    if (!xeroLeaveTypeId) {
      skipped.push(`${who} (${r.leaveTypeName ?? "leave"} not mapped)`);
      continue;
    }
    inputs.push({
      requestId: r.id,
      xeroEmployeeId: xeroEmpId,
      xeroLeaveTypeId,
      title: `${r.leaveTypeName ?? "Leave"} (ShiftCraft)`,
      startDate: r.startDate,
      endDate: r.endDate,
    });
  }

  if (inputs.length === 0) {
    return {
      status: "error",
      message: `Nothing pushed. ${skipped.length} skipped: ${skipped.join("; ")}`,
    };
  }

  let results: Awaited<ReturnType<typeof pushLeaveApplications>>;
  try {
    results = await pushLeaveApplications(tenantId, inputs);
  } catch (err) {
    return {
      status: "error",
      message: `Xero rejected the leave push: ${err instanceof Error ? err.message : "unknown error"}.`,
    };
  }

  let pushed = 0;
  const failed: string[] = [];
  for (const res of results) {
    if (res.leaveApplicationId) {
      await forTenant(tenantId).run((tx) =>
        tx
          .update(scTimeOffRequests)
          .set({ xeroLeaveApplicationId: res.leaveApplicationId })
          .where(
            and(
              eq(scTimeOffRequests.id, res.requestId),
              eq(scTimeOffRequests.traceyTenantId, tenantId),
            ),
          ),
      );
      pushed += 1;
    } else {
      failed.push(res.error ?? "unknown error");
    }
  }

  await logAuditEvent({
    action: "shiftcraft.xero.leave_pushed",
    targetKind: "sc_time_off_requests",
    details: {
      rangeStart: parsed.data.rangeStart,
      rangeEnd: parsed.data.rangeEnd,
      pushed,
      skipped: skipped.length,
      failed: failed.length,
      submittedByUserId: user.id,
    },
  });

  revalidatePath("/app/admin/payroll");
  const parts = [`Pushed ${pushed} leave application${pushed === 1 ? "" : "s"} to Xero.`];
  if (skipped.length > 0) parts.push(`Skipped ${skipped.length}: ${skipped.join("; ")}`);
  if (failed.length > 0) parts.push(`Failed ${failed.length}: ${failed.join("; ")}`);
  return {
    status: failed.length > 0 ? "error" : "ok",
    message: parts.join(" "),
  };
}

const readbackSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  xeroPayRunId: z.string().min(1).max(200),
});

export async function readbackPayRunAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!isXeroConfigured()) {
    return { status: "error", message: "Xero is not configured." };
  }
  const parsed = readbackSchema.safeParse({
    weekStart: formData.get("weekStart"),
    xeroPayRunId: formData.get("xeroPayRunId"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Pick a week and paste a Xero pay run id." };
  }
  const membership = await requireManager();
  const tenantId = membership.tenant.id;

  let summary;
  try {
    summary = await fetchPayRunSummary(tenantId, parsed.data.xeroPayRunId);
  } catch (err) {
    return {
      status: "error",
      message: `Xero read failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  if (!summary) {
    return {
      status: "error",
      message: "Xero returned no pay run for that id.",
    };
  }

  await forTenant(tenantId).run((tx) =>
    tx
      .insert(scXeroPayRuns)
      .values({
        traceyTenantId: tenantId,
        weekStart: parsed.data.weekStart,
        status: "finalised",
        xeroPayRunId: parsed.data.xeroPayRunId,
        summary,
        finalisedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [scXeroPayRuns.traceyTenantId, scXeroPayRuns.weekStart],
        set: {
          status: "finalised",
          xeroPayRunId: parsed.data.xeroPayRunId,
          summary,
          finalisedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
  );

  await logAuditEvent({
    action: "shiftcraft.xero.pay_run_readback",
    targetKind: "sc_xero_pay_run",
    details: {
      weekStart: parsed.data.weekStart,
      xeroPayRunId: parsed.data.xeroPayRunId,
      netPay: summary.netPay,
    },
  });

  revalidatePath("/app/timesheets");
  revalidatePath("/app/admin/payroll");
  return {
    status: "ok",
    message: `Finalised totals saved. Gross $${(summary.wages ?? 0).toFixed(2)} · Net $${(summary.netPay ?? 0).toFixed(2)}.`,
  };
}
