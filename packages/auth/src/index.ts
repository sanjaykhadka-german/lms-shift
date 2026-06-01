// Vestigial package — Auth.js helpers (currentUser, currentTenant, etc.)
// live in each app's lib/auth/current.ts because they depend on that
// app's own NextAuth instance. This package only re-exports the shared
// Role type so apps in this monorepo (lms-web, tracey-planning,
// shift-craft) agree on the role vocabulary.
//
// There is intentionally no requireRole() here: role enforcement needs
// the session, which only the app layer has, so it lives there
// (lib/roles.ts: isAtLeastManager / isAdmin + inline membership.role
// checks). A throwing stub used to sit here and was removed (AUDIT
// gap #5) — it could never be implemented correctly at this layer, so
// keeping it only risked a future import crashing a route.

export type { Role } from "@tracey/db";
