"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, invitations, members, users } from "@tracey/db";
import { currentMembership, currentUser } from "~/lib/auth/current";
import { isAtLeastManager } from "~/lib/roles";
import { sendInvitationEmail } from "~/lib/auth/email";
import { generateToken, tokenExpiry } from "~/lib/auth/tokens";
import { logAuditEvent } from "~/lib/audit";

// Invite + revoke for app.members. Mirrors apps/lms-web/app/app/members/
// actions.ts with shiftcraft-web's conventions (currentMembership +
// isAtLeastManager instead of requireTenant). Same shared `app.invitations`
// table — the accepted invite gives access to both lms-web and
// shiftcraft-web, so the email's accept URL points at lms-web (see
// lib/auth/email.ts).

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "member"]),
});

export type InviteState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export async function createInvitationAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    return {
      status: "error",
      message: "Only Managers and Admins can invite teammates.",
    };
  }
  const tenant = membership.tenant;

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { email, role } = parsed.data;

  // Already a member of this tenant?
  const [existingMember] = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.tenantId, tenant.id), eq(users.email, email)))
    .limit(1);
  if (existingMember) {
    return {
      status: "error",
      message: `${email} is already a member of this workspace.`,
    };
  }

  // Existing pending invitation?
  const [existingInvite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(eq(invitations.tenantId, tenant.id), eq(invitations.email, email)),
    )
    .limit(1);
  if (existingInvite) {
    return {
      status: "error",
      message: `${email} has already been invited. Revoke the existing invitation first if you want to re-send.`,
    };
  }

  const token = generateToken();
  const [invRow] = await db
    .insert(invitations)
    .values({
      tenantId: tenant.id,
      email,
      role,
      token,
      expiresAt: tokenExpiry(24 * 7), // 7 days
      invitedByUserId: me.id,
    })
    .returning({ id: invitations.id });

  try {
    await sendInvitationEmail({
      to: email,
      token,
      tenantName: tenant.name,
      inviterName: me.name,
    });
  } catch (err) {
    // Roll back the invitation row so the user can retry without seeing a
    // stale pending invite.
    await db.delete(invitations).where(eq(invitations.token, token));
    console.error("[invitation] email send failed:", err);
    return {
      status: "error",
      message: "We couldn't send the invitation email. Please try again.",
    };
  }

  await logAuditEvent({
    action: "tenant.member.invited",
    targetKind: "invitation",
    targetId: invRow?.id ?? null,
    details: { email, role },
  });

  revalidatePath("/app/admin/members");
  return { status: "ok", message: `Invitation sent to ${email}.` };
}

const revokeSchema = z.object({
  invitationId: z.string().uuid(),
});

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const me = await currentUser();
  const membership = await currentMembership();
  if (!me || !membership || !isAtLeastManager(membership.role)) {
    throw new Error("Forbidden");
  }
  const tenantId = membership.tenant.id;

  const parsed = revokeSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) {
    throw new Error("Invalid invitation id");
  }

  // Capture invite details for the audit log before deleting. Tenant scope
  // on the SELECT guards against an admin in tenant A revoking tenant B's
  // invite via a crafted form post.
  const [target] = await db
    .select({ email: invitations.email, role: invitations.role })
    .from(invitations)
    .where(
      and(
        eq(invitations.id, parsed.data.invitationId),
        eq(invitations.tenantId, tenantId),
      ),
    )
    .limit(1);

  await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.id, parsed.data.invitationId),
        eq(invitations.tenantId, tenantId),
      ),
    );

  if (target) {
    await logAuditEvent({
      action: "tenant.member.invite_revoked",
      targetKind: "invitation",
      targetId: parsed.data.invitationId,
      details: { email: target.email, role: target.role },
    });
  }

  revalidatePath("/app/admin/members");
}
