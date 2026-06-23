"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { forTenant, scShiftComments } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { isAtLeastManager } from "~/lib/roles";

export type CommentFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

const commentSchema = z.object({
  shiftId: z.string().uuid("Bad shift id"),
  body: z.string().trim().min(1, "Say something").max(2000, "Too long"),
});

/**
 * Post a comment on a shift. Comments are an INTERNAL supervisor channel
 * (whoever is moving/covering the shift) — only managers/admins may post,
 * and they are never surfaced on the employee-facing /my-shifts view. The
 * action stamps the author so the UI can show "by Lena · 3 minutes ago".
 *
 * Returns a CommentFormState so the form can clear on success — bound
 * via useActionState in the client component.
 */
export async function postShiftCommentAction(
  _prev: CommentFormState,
  formData: FormData,
): Promise<CommentFormState> {
  const user = await currentUser();
  if (!user) return { status: "error", message: "Not signed in." };
  const m = await currentMembership();
  if (!m) return { status: "error", message: "No workspace selected." };
  // Internal channel — supervisors/admins only.
  if (!isAtLeastManager(m.role)) {
    return {
      status: "error",
      message: "Only supervisors can post internal comments.",
    };
  }

  const parsed = commentSchema.safeParse({
    shiftId: formData.get("shiftId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid comment.",
    };
  }

  await forTenant(m.tenant.id).run((tx) =>
    tx.insert(scShiftComments).values({
      traceyTenantId: m.tenant.id,
      shiftId: parsed.data.shiftId,
      authorUserId: user.id,
      body: parsed.data.body,
    }),
  );

  await logAuditEvent({
    action: "shiftcraft.shift_comment.posted",
    targetKind: "sc_shift",
    targetId: parsed.data.shiftId,
    details: { length: parsed.data.body.length },
  });

  revalidatePath(`/app/schedule/${parsed.data.shiftId}/edit`);
  revalidatePath("/app/my-shifts");
  return { status: "ok" };
}

/**
 * Delete a comment. Authors can delete their own; admins/owners can
 * delete anyone's. Anything else is silently no-op (form action returns
 * void).
 */
export async function deleteShiftCommentAction(
  formData: FormData,
): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const m = await currentMembership();
  if (!m) return;
  const tenantId = m.tenant.id;

  const id = String(formData.get("id") ?? "");
  const shiftId = String(formData.get("shiftId") ?? "");
  if (!id) return;

  // Pull the row first so we can authz the actor + capture the body for
  // the audit log.
  const [row] = await forTenant(tenantId).run((tx) =>
    tx
      .select({
        id: scShiftComments.id,
        authorUserId: scShiftComments.authorUserId,
        body: scShiftComments.body,
        shiftId: scShiftComments.shiftId,
      })
      .from(scShiftComments)
      .where(
        and(
          eq(scShiftComments.id, id),
          eq(scShiftComments.traceyTenantId, tenantId),
        ),
      )
      .limit(1),
  );
  if (!row) return;
  const isAuthor = row.authorUserId === user.id;
  if (!isAuthor && !isAtLeastManager(m.role)) return;

  await forTenant(tenantId).run((tx) =>
    tx
      .delete(scShiftComments)
      .where(
        and(
          eq(scShiftComments.id, id),
          eq(scShiftComments.traceyTenantId, tenantId),
        ),
      ),
  );
  await logAuditEvent({
    action: "shiftcraft.shift_comment.deleted",
    targetKind: "sc_shift_comment",
    targetId: id,
    details: {
      shiftId: row.shiftId,
      wasAuthor: isAuthor,
      length: row.body.length,
    },
  });

  if (shiftId) revalidatePath(`/app/schedule/${shiftId}/edit`);
  revalidatePath("/app/my-shifts");
}
