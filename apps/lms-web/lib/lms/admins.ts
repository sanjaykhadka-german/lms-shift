import "server-only";
import { and, eq } from "drizzle-orm";
import { db, members, users } from "@tracey/db";

// Returns the email of every member with role='owner' for the given tenant.
// Plural because the schema allows multiple owners (members_tenant_user_uq
// constrains (tenant,user) only — promote-to-owner from the members UI can
// produce N>1). Admins are intentionally excluded from email recipients;
// they still see the in-app notification (learner.ts:564-576).
export async function getTenantOwnerEmails(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(
      and(
        eq(members.tenantId, tenantId),
        eq(members.role, "owner"),
      ),
    );
  return [...new Set(rows.map((r) => r.email))];
}
