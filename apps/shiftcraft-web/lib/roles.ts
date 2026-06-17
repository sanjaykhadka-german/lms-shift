import type { Role } from "@tracey/db";

// ShiftCraft uses Deputy-style tier names (Admin / Manager / Employee) in
// the UI on top of Tracey's underlying owner/admin/member roles. Mapping
// is purely cosmetic — the auth/DB layer stays unchanged.
//
//   Tracey owner            → "Admin"            (full access incl. billing)
//   Tracey admin            → "Manager"          (manage schedule, employees, tasks — all locations)
//   Tracey location_manager → "Location Manager" (a Manager scoped to their assigned location(s);
//                                                  no billing / workspace settings / manager-scopes)
//   Tracey member           → "Employee"         (own-self actions only)
//
// Keeping the cosmetic layer here means lms-web / planning-web continue
// using the same owner/admin/member labels they already do — no
// cross-app schema or label coordination needed.

export type FriendlyRole = "Admin" | "Location Manager" | "Manager" | "Employee";

export function friendlyRoleLabel(role: Role | string): FriendlyRole {
  switch (role) {
    case "owner":
      return "Admin";
    case "admin":
      return "Manager";
    case "location_manager":
      return "Location Manager";
    case "member":
    default:
      return "Employee";
  }
}

export interface RoleDescription {
  label: FriendlyRole;
  underlying: Role;
  blurb: string;
  can: string[];
  cannot: string[];
}

export const ROLE_DESCRIPTIONS: Record<Role, RoleDescription> = {
  owner: {
    label: "Admin",
    underlying: "owner",
    blurb:
      "Full access to the workspace including billing, members, and tenant settings.",
    can: [
      "Everything a Manager can do",
      "Change billing plan and seat count",
      "Invite or remove members",
      "Transfer ownership",
    ],
    cannot: [],
  },
  admin: {
    label: "Manager",
    underlying: "admin",
    blurb:
      "Day-to-day workspace management. Manage rosters, schedules, and tasks; cannot touch billing or membership.",
    can: [
      "Add / edit employees, locations, shifts",
      "Approve time-off and shift swaps",
      "Post announcements and tasks",
      "View Reports and export timesheets",
    ],
    cannot: ["Change billing", "Invite or remove members"],
  },
  location_manager: {
    label: "Location Manager",
    underlying: "location_manager",
    blurb:
      "A Manager restricted to their assigned location(s). Runs the roster, timesheets, and people for those sites only — no billing, workspace settings, or cross-location access.",
    can: [
      "Manage schedule, shifts and timesheets at their location(s)",
      "Add / edit employees and approve time-off at their location(s)",
      "Post announcements and tasks",
    ],
    cannot: [
      "Access other locations",
      "Change billing or workspace settings",
      "Manage manager scopes or membership",
    ],
  },
  member: {
    label: "Employee",
    underlying: "member",
    blurb:
      "Self-service access. See your own shifts, clock in/out, request time off.",
    can: [
      "View own shifts and timesheets",
      "Clock in / out and take breaks",
      "Request time off and propose shift swaps",
      "See dashboard announcements and assigned tasks",
    ],
    cannot: [
      "Edit other employees",
      "Modify the schedule",
      "Approve time-off",
    ],
  },
};

/**
 * Numeric rank — useful for comparisons. owner=2, admin=1,
 * location_manager=1, member=0.
 *
 * location_manager ranks at the Manager tier: it passes every
 * `isAtLeastManager` gate (the operational surfaces — schedule, timesheets,
 * people, etc.) but, being neither "owner" nor "admin", is automatically
 * excluded from owner-only checks (`isAdmin`) and from `isWorkspaceAdmin`
 * (billing / workspace settings). Its reach is then narrowed to its assigned
 * sites by the location-scope helpers in lib/manager-scope.ts.
 */
export function roleRank(role: Role | string): number {
  switch (role) {
    case "owner":
      return 2;
    case "admin":
    case "location_manager":
      return 1;
    case "member":
    default:
      return 0;
  }
}

export function isAtLeastManager(role: Role | string): boolean {
  return roleRank(role) >= 1;
}

/** Owner-only (full workspace control incl. billing, ownership transfer). */
export function isAdmin(role: Role | string): boolean {
  return roleRank(role) >= 2;
}

/**
 * Full, non-scoped workspace administration — owner OR admin (Manager), but
 * NOT a location_manager. Use this to gate surfaces a Manager may reach that a
 * Location Manager must not: workspace settings, integration config, etc.
 */
export function isWorkspaceAdmin(role: Role | string): boolean {
  return role === "owner" || role === "admin";
}

/** True for the location-scoped Manager tier. */
export function isLocationManager(role: Role | string): boolean {
  return role === "location_manager";
}
