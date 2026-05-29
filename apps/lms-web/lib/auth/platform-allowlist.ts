/**
 * Pure helper that decides whether a given email is a platform admin.
 * Kept dependency-free (no next-auth, no DB, no server-only) so it's
 * trivially unit-testable; the auth-aware `requirePlatformAdmin` wrapper
 * lives in ./platform.ts.
 */

function adminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(email: string): boolean {
  if (!email || !email.trim()) return false;
  return adminEmails().has(email.trim().toLowerCase());
}
