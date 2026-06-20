"use server";

import { redirect } from "next/navigation";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { runApprovalDigest } from "~/lib/timesheet-approvals";

// R1 Features 3+4 — manual "email managers a summary" trigger. ShiftCraft has
// no cron (Render dropped free crons), so an admin sends the digest on their
// own cadence, mirroring the WHS-reminder button in lms-web. Covers the weekly
// approval summary AND the >7-day stale nudge in one digest.
export async function sendApprovalDigestAction(): Promise<void> {
  const m = await currentMembership();
  if (!m) throw new Error("You must belong to a workspace.");
  if (!isAtLeastManager(m.role)) {
    throw new Error("Only managers can send the approval digest.");
  }
  const result = await runApprovalDigest(m.tenant.id, m.tenant.name);
  await logAuditEvent({
    action: "shiftcraft.timesheet.digest_sent",
    targetKind: "tenant",
    targetId: m.tenant.id,
    details: {
      totalPending: result.totalPending,
      staleCount: result.staleCount,
      weeksReported: result.weeksReported,
    },
  });
  redirect(`/app/timesheets?digest=${result.totalPending}`);
}
