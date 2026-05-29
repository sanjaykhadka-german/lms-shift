import "server-only";

export type Role = "admin" | "manager" | "member";

/**
 * Stub for Phase 2+. Will eventually check the Clerk session for the active
 * organisation membership role and throw if it does not match `required`.
 *
 * Throws unconditionally in Phase 1 so accidental use is loud.
 */
export function requireRole(_required: Role): never {
  throw new Error(
    "requireRole() is not implemented in Phase 1 — wire up in Phase 2 when " +
      "Flask SSO and per-tenant roles land.",
  );
}
