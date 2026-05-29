import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, invitations, tenants } from "@tracey/db";

export interface PendingInvitation {
  token: string;
  tenantId: string;
  tenantName: string;
  role: string;
}

export async function findPendingInvitationForEmail(
  email: string,
): Promise<PendingInvitation | null> {
  const normalised = email.trim().toLowerCase();
  const [row] = await db
    .select({
      token: invitations.token,
      tenantId: invitations.tenantId,
      tenantName: tenants.name,
      role: invitations.role,
    })
    .from(invitations)
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(
      and(
        sql`lower(${invitations.email}) = ${normalised}`,
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt))
    .limit(1);
  return row ?? null;
}
