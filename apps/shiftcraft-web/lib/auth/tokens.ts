import "server-only";
import { randomBytes } from "node:crypto";

/**
 * URL-safe random token for invitation acceptance. 32 bytes = 256 bits of
 * entropy → 43 base64url chars. Mirrors apps/lms-web/lib/auth/tokens.ts
 * so the two apps generate compatible tokens against the shared
 * app.invitations table.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenExpiry(hours = 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
