import type { Role } from "@tracey/db";

// Flask roles: employee | qaqc | admin (free-text on lmsUsers.role).
// Tracey roles: owner | admin | member (enum on app.members.role).
// QA/QC has no Tracey equivalent — collapse it into admin so QA/QC users
// keep author-level access.
//
// (The transparent Flask password bridge that used to live here was removed
// when authentication moved to Supabase Auth — there is no legacy password
// store to fall back to anymore.)
export function mapFlaskRole(flaskRole: string | null | undefined): Role {
  if (flaskRole === "admin" || flaskRole === "qaqc") return "admin";
  return "member";
}
