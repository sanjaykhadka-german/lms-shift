import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, members, tenants, users, type Tenant, type Role } from "@tracey/db";
import { createClient } from "~/lib/supabase/server";

const ACTIVE_TENANT_COOKIE = "tracey.activeTenant";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface Membership {
  tenant: Tenant;
  role: Role;
}

/**
 * Returns the signed-in user, or null. Reads + revalidates the Supabase
 * session (getUser() verifies the JWT against Supabase, unlike getSession()).
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id || !user.email) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>;
  return {
    id: user.id,
    email: user.email,
    name: meta.name ?? meta.full_name ?? null,
    image: meta.avatar_url ?? null,
  };
}

/**
 * Upserts the app.users profile row, keyed by the SAME uuid as the Supabase
 * auth user. Every domain FK (members.userId, tenants.ownerUserId, …) points
 * here, so this must exist before onboarding inserts a tenant/membership.
 */
async function getOrProvisionProfile(u: CurrentUser): Promise<void> {
  await db
    .insert(users)
    .values({ id: u.id, email: u.email, name: u.name, image: u.image })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: u.email, updatedAt: new Date() },
    });
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/sign-in");
  await getOrProvisionProfile(u);
  return u;
}

/**
 * Returns the user's active tenant + role.
 *
 * Resolution order:
 *   1. Cookie `tracey.activeTenant` — if present and the user is still a
 *      member, return that tenant.
 *   2. The user's most-recently-created membership — sets the cookie as a
 *      side-effect so subsequent calls take the fast path.
 *   3. null — user has no memberships yet (nudge to /onboarding).
 */
export async function currentTenant(): Promise<Tenant | null> {
  const m = await currentMembership();
  return m?.tenant ?? null;
}

export async function currentMembership(): Promise<Membership | null> {
  const u = await currentUser();
  if (!u) return null;

  const cookieStore = await cookies();
  const activeFromCookie = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;

  if (activeFromCookie) {
    const row = await fetchMembership(u.id, activeFromCookie);
    if (row) return row;
    // Stale cookie (membership revoked or tenant deleted). Fall through to
    // the most-recent-membership path.
  }

  const [first] = await db
    .select({
      tenant: tenants,
      role: members.role,
    })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(eq(members.userId, u.id))
    .orderBy(desc(members.createdAt))
    .limit(1);
  if (!first) return null;

  // Best-effort: persist as the active tenant. Cookies set in Server
  // Components throw at render time, so swallow the error silently — the
  // server action that switches tenants will set the cookie correctly.
  try {
    cookieStore.set(ACTIVE_TENANT_COOKIE, first.tenant.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  } catch {
    // Server Component context — ignore.
  }

  return { tenant: first.tenant, role: first.role as Role };
}

export async function requireTenant(): Promise<Membership> {
  await requireUser();
  const m = await currentMembership();
  if (!m) redirect("/onboarding");
  return m;
}

export async function listUserTenants(): Promise<Membership[]> {
  const u = await currentUser();
  if (!u) return [];
  const rows = await db
    .select({
      tenant: tenants,
      role: members.role,
    })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(eq(members.userId, u.id))
    .orderBy(desc(members.createdAt));
  return rows.map((r) => ({ tenant: r.tenant, role: r.role as Role }));
}

async function fetchMembership(userId: string, tenantId: string): Promise<Membership | null> {
  const [row] = await db
    .select({
      tenant: tenants,
      role: members.role,
    })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(and(eq(members.userId, userId), eq(members.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  return { tenant: row.tenant, role: row.role as Role };
}

export async function setActiveTenant(tenantId: string): Promise<void> {
  const u = await requireUser();
  const m = await fetchMembership(u.id, tenantId);
  if (!m) {
    throw new Error("You are not a member of that workspace.");
  }
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

// Re-export the Drizzle Tenant type so call sites only need to import from
// this module.
export type { Tenant } from "@tracey/db";
