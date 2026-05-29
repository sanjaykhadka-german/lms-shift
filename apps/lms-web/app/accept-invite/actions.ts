"use server";

import { redirect } from "next/navigation";
import { and, eq, ne, or } from "drizzle-orm";
import { db, forTenant, invitations, members } from "@tracey/db";
import { currentUser, setActiveTenant } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";
import { createNotifications } from "~/lib/lms/notifications";

/**
 * Accept an invitation. Server action; expects `token` in form data.
 *
 * Caller MUST be signed in with the email the invitation was sent to.
 * The page-level guard already enforces this, but we re-check here in case
 * the form is replayed.
 */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) throw new Error("Missing token");

  const me = await currentUser();
  if (!me) {
    redirect(`/sign-in?returnTo=${encodeURIComponent(`/accept-invite?token=${token}`)}`);
  }

  const [inv] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  if (!inv) throw new Error("Invitation not found");
  if (inv.expiresAt.getTime() < Date.now()) {
    throw new Error("Invitation expired");
  }
  if (inv.email.toLowerCase() !== me.email.toLowerCase()) {
    throw new Error("Invitation email does not match the signed-in account");
  }

  // Idempotent: if a member row already exists, just switch to the tenant.
  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.tenantId, inv.tenantId), eq(members.userId, me.id)))
    .limit(1);
  if (!existing) {
    await db.insert(members).values({
      tenantId: inv.tenantId,
      userId: me.id,
      role: inv.role,
    });
  }

  // Single-use: drop the invitation row so it can't be replayed.
  await db.delete(invitations).where(eq(invitations.id, inv.id));

  await logAuditEvent({
    tenantId: inv.tenantId,
    actorUserId: me.id,
    actorEmail: me.email,
    action: "member.joined",
    targetKind: "member",
    targetId: me.id,
    details: { role: inv.role, via: "invitation" },
  });

  // Notify owners + admins + the inviter (deduplicated, never the joiner themselves).
  if (!existing) {
    try {
      const adminMembers = await db
        .select({ userId: members.userId })
        .from(members)
        .where(
          and(
            eq(members.tenantId, inv.tenantId),
            or(eq(members.role, "owner"), eq(members.role, "admin")),
            ne(members.userId, me.id),
          ),
        );
      const recipientIds = new Set(adminMembers.map((m) => m.userId));
      if (inv.invitedByUserId !== me.id) recipientIds.add(inv.invitedByUserId);
      if (recipientIds.size > 0) {
        const joinerLabel = me.name ?? me.email;
        await createNotifications(
          forTenant(inv.tenantId),
          Array.from(recipientIds).map((uid) => ({
            recipientUserId: uid,
            kind: "member.joined",
            title: `${joinerLabel} joined the workspace`,
            body: `Role: ${inv.role}`,
            actionUrl: "/app/members",
          })),
        );
      }
    } catch (err) {
      console.error("[notifications] member.joined failed", err);
    }
  }

  await setActiveTenant(inv.tenantId);
  redirect("/app");
}
