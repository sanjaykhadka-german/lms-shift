/**
 * Pure helper that decides whether an email is a platform admin. Reads
 * PLATFORM_ADMIN_EMAILS (comma-separated, case-insensitive) — the same
 * env var lms-web's /platform uses, so adding an email there grants
 * access to both apps' platform surfaces in one step.
 *
 * No dependencies (no next-auth, no DB) so it's trivially unit-testable;
 * the auth-aware wrapper lives in ./platform.ts.
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
