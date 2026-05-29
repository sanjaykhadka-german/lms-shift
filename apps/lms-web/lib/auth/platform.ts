import "server-only";
import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "./current";
import { isPlatformAdmin } from "./platform-allowlist";

export { isPlatformAdmin } from "./platform-allowlist";

/**
 * Server-side guard for `/platform/*` pages and actions. Requires a signed-in
 * user *and* membership in the platform admin allow-list.
 *
 * Returns 404 (via notFound) instead of 403 so the existence of the
 * platform surface isn't leaked to non-admins.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  return user;
}
