"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scShiftAssignments } from "@tracey/db";
import { currentMembership } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";

// Accepts a proposal (JSON-encoded array of {shiftId, userId}) and
// bulk-inserts assignments at status='offered'. Bound to a <form
// action={...}> so the page can build the form on the fly with hidden
// inputs encoding the proposal. Idempotent via onConflictDoNothing
// against sc_shift_user_uq — re-accepting the same proposal is a
// no-op rather than an error.

const acceptSchema = z.object({
  proposal: z
    .string()
    .min(2)
    .transform((s) => {
      try {
        const parsed = JSON.parse(s) as unknown;
        const result = z
          .array(
            z.object({
              shiftId: z.string().uuid(),
              userId: z.string().uuid(),
            }),
          )
          .safeParse(parsed);
        return result.success ? result.data : null;
      } catch {
        return null;
      }
    })
    .refine((v) => v !== null && v.length > 0, "Proposal is empty"),
});

export async function acceptProposalAction(formData: FormData): Promise<void> {
  const parsed = acceptSchema.safeParse({
    proposal: String(formData.get("proposal") ?? ""),
  });
  if (!parsed.success) return;
  const membership = await currentMembership();
  if (!membership) return;
  if (!isAtLeastManager(membership.role)) return;
  const tenantId = membership.tenant.id;
  const proposal = parsed.data.proposal!;

  let inserted = 0;
  await forTenant(tenantId).run(async (tx) => {
    for (const p of proposal) {
      const result = await tx
        .insert(scShiftAssignments)
        .values({
          shiftId: p.shiftId,
          userId: p.userId,
          status: "offered",
        })
        .onConflictDoNothing()
        .returning({ id: scShiftAssignments.id });
      if (result.length > 0) inserted += 1;
    }
  });

  await logAuditEvent({
    action: "shiftcraft.auto_scheduler.proposal_accepted",
    targetKind: "sc_shift_assignments",
    details: { proposed: proposal.length, inserted },
  });

  revalidatePath("/app/schedule");
  revalidatePath("/app/coverage-gaps");
  redirect(`/app/schedule/auto-fill?accepted=${inserted}`);
}
