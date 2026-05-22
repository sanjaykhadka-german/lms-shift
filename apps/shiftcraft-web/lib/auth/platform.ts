import "server-only";
import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "./current";
import { isPlatformAdmin } from "./platform-allowlist";

export { isPlatformAdmin } from "./platform-allowlist";

/**
 * Server-side guard for `/platform/*` pages. Requires a signed-in user
 * AND membership in PLATFORM_ADMIN_EMAILS. Returns 404 (not 403) to
 * non-admins so the surface's existence isn't leaked.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  return user;
}
