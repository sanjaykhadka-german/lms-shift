"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  forTenant,
  invitations,
  members,
  scEmployees,
  users,
} from "@tracey/db";
import { currentUser, setActiveTenant } from "~/lib/auth/current";
import { logAuditEvent } from "~/lib/audit";

/**
 * Accept an invitation. Server action; expects `token` in form data.
 *
 * Caller MUST be signed in with the email the invitation was sent to.
 * The page-level guard already enforces this, but we re-check here in case
 * the form is replayed. Reads/writes the shared app.invitations / app.members
 * tables (no app-scoping column — membership grants both apps), so the logic
 * mirrors lms-web's accept-invite verbatim apart from the audit/notify wiring.
 */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) throw new Error("Missing token");

  const me = await currentUser();
  if (!me) {
    redirect(
      `/sign-in?returnTo=${encodeURIComponent(`/accept-invite?token=${token}`)}`,
    );
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
      kind: inv.kind,
    });
  }

  // Back-fill the roster link. The common flow is: an admin adds the hire on
  // /app/employees (which creates an sc_employees row with app_user_id=NULL and
  // sends this invite), then the hire accepts. Without this step the profile
  // lookup at /app/welcome (eq(scEmployees.appUserId, user.id)) never matches,
  // so the user is stuck on the "ask your manager to add you" fallback even
  // though their roster row already exists. Match by email within the tenant
  // and only claim a row that isn't already linked to someone else.
  // sc_employees is per-tenant, so this must run through forTenant().
  await forTenant(inv.tenantId).run((tx) =>
    tx
      .update(scEmployees)
      .set({ appUserId: me.id, updatedAt: new Date() })
      .where(
        and(
          eq(scEmployees.traceyTenantId, inv.tenantId),
          isNull(scEmployees.appUserId),
          sql`lower(${scEmployees.email}) = lower(${me.email})`,
        ),
      ),
  );

  // Promote email-verified status if not already (the invitation email proves
  // ownership of the address).
  await db
    .update(users)
    .set({ emailVerified: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, me.id), isNull(users.emailVerified)));

  // Single-use: drop the invitation row so it can't be replayed.
  await db.delete(invitations).where(eq(invitations.id, inv.id));

  // Switch to the joined workspace BEFORE auditing — shiftcraft's
  // logAuditEvent derives tenant/actor from the active membership, so the
  // cookie must point at inv.tenantId for the event to attribute correctly.
  await setActiveTenant(inv.tenantId);

  await logAuditEvent({
    action: "member.joined",
    targetKind: "member",
    targetId: me.id,
    details: { role: inv.role, via: "invitation" },
  });

  redirect("/app");
}
