// Shared auth types/utilities. The per-request auth helpers (currentUser,
// currentTenant, etc.) live in each app's lib/auth/current.ts because they
// depend on that app's Supabase server client (bound to next/headers cookies).
// This package re-exports the shared Role type + a role-check utility.

export type { Role } from "@tracey/db";
export { requireRole } from "./require-role";
