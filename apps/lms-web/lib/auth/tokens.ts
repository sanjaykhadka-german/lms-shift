import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Generate a URL-safe random token for email verification, password reset,
 * or invitation acceptance. 32 bytes = 256 bits of entropy → 43 base64url
 * chars. Effectively unguessable.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenExpiry(hours = 24): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
