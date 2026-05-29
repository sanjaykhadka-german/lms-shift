import "server-only";
import { eq } from "drizzle-orm";
import { forTenant, lmsUsers } from "@tracey/db";
import { currentMembership, currentUser } from "./current";

export interface AuthorContext {
  traceyTenantId: string;
  traceyUserId: string;
  membershipRole: string;
  lmsRole: string | null;
}

// Mirrors Flask's @author_required (current_user.can_author): owner/admin
// in Tracey OR qaqc in the legacy LMS role. Returns null when the user
// has no author access — callers should respond 401 / hide UI.
export async function getAuthorAccess(): Promise<AuthorContext | null> {
  const u = await currentUser();
  if (!u) return null;
  const m = await currentMembership();
  if (!m) return null;

  if (m.role === "owner" || m.role === "admin") {
    return {
      traceyTenantId: m.tenant.id,
      traceyUserId: u.id,
      membershipRole: m.role,
      lmsRole: null,
    };
  }

  // Membership is already resolved above (m.tenant.id), so run this lookup
  // inside forTenant(...) for consistency with every other LMS query.
  // public.users is RLS-excluded today (see 0004_enable_rls.sql:105-115);
  // this wrap costs nothing now and removes the breakage risk if/when
  // users joins RLS coverage in a future Phase 5.x cleanup.
  const [row] = await forTenant(m.tenant.id).run((tx) =>
    tx
      .select({ role: lmsUsers.role })
      .from(lmsUsers)
      .where(eq(lmsUsers.traceyUserId, u.id))
      .limit(1),
  );
  if (row?.role === "qaqc") {
    return {
      traceyTenantId: m.tenant.id,
      traceyUserId: u.id,
      membershipRole: m.role,
      lmsRole: "qaqc",
    };
  }
  return null;
}
