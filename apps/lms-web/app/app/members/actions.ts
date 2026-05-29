"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, invitations, members, users } from "@tracey/db";
import { requireUser, requireTenant } from "~/lib/auth/current";
import { generateToken, tokenExpiry } from "~/lib/auth/tokens";
import { sendInvitationEmail } from "~/lib/auth/email";
import { logAuditEvent } from "~/lib/audit";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
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
  const user = await requireUser();
  const { tenant, role: actorRole } = await requireTenant();
  if (actorRole !== "owner" && actorRole !== "admin") {
    return { status: "error", message: "Only owners and admins can invite teammates." };
  }

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
    return { status: "error", message: `${email} is already a member of this workspace.` };
  }

  // Already a pending invitation to this tenant?
  const [existingInvite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenant.id), eq(invitations.email, email)))
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
      invitedByUserId: user.id,
    })
    .returning({ id: invitations.id });

  try {
    await sendInvitationEmail({
      to: email,
      token,
      tenantName: tenant.name,
      inviterName: user.name,
    });
  } catch (err) {
    // Roll back the invitation row so the user can retry.
    await db.delete(invitations).where(eq(invitations.token, token));
    console.error("[invitation] email send failed:", err);
    return {
      status: "error",
      message: "We couldn't send the invitation email. Please try again.",
    };
  }

  await logAuditEvent({
    tenantId: tenant.id,
    actorUserId: user.id,
    actorEmail: user.email,
    action: "invitation.created",
    targetKind: "invitation",
    targetId: invRow?.id,
    details: { email, role },
  });

  revalidatePath("/app/members");
  return { status: "ok", message: `Invitation sent to ${email}.` };
}

const revokeSchema = z.object({
  invitationId: z.string().uuid(),
});

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const { tenant, role } = await requireTenant();
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden");
  }
  const parsed = revokeSchema.safeParse({
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) {
    throw new Error("Invalid invitation id");
  }
  // Capture invite email for the audit log before we delete.
  const [target] = await db
    .select({ email: invitations.email, role: invitations.role })
    .from(invitations)
    .where(
      and(
        eq(invitations.id, parsed.data.invitationId),
        eq(invitations.tenantId, tenant.id),
      ),
    )
    .limit(1);
  // Scope by tenant_id so an admin in tenant A can't revoke tenant B's invite.
  await db
    .delete(invitations)
    .where(
      and(
        eq(invitations.id, parsed.data.invitationId),
        eq(invitations.tenantId, tenant.id),
      ),
    );
  if (target) {
    await logAuditEvent({
      tenantId: tenant.id,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "invitation.revoked",
      targetKind: "invitation",
      targetId: parsed.data.invitationId,
      details: { email: target.email, role: target.role },
    });
  }
  revalidatePath("/app/members");
}
