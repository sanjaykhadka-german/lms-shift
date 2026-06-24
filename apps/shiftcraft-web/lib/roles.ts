import type { Role } from "@tracey/db";

// ShiftCraft presents four access levels in the UI — Admin / Site Manager /
// Lead / Employee — on top of Tracey's underlying owner/admin/location_manager/
// member roles. The mapping is purely cosmetic; the auth/DB layer is unchanged
// and lms-web / planning-web keep their own owner/admin/member labels.
//
//   Tracey owner            → "Admin"        (full access incl. billing/ownership)
//   Tracey admin            → "Admin"        (full workspace administration)
//   Tracey location_manager → "Site Manager" (Admin scoped to their site(s) via
//                                              sc_manager_locations — no billing /
//                                              workspace settings / role mgmt)
//   Tracey lead             → "Lead"          (approve-only team supervisor,
//                                              scoped to their area(s) via
//                                              sc_lead_areas: view team schedule +
//                                              view/approve team timesheets only)
//   Tracey member           → "Employee"      (own-self actions only)
//
// owner + admin both render as "Admin" (the two top tiers are folded into one
// staff-visible level); owner stays the protected billing/account holder under
// the hood (only owner can transfer ownership / change billing).

export type FriendlyRole = "Admin" | "Site Manager" | "Lead" | "Employee";

export function friendlyRoleLabel(role: Role | string): FriendlyRole {
  switch (role) {
    case "owner":
    case "admin":
      return "Admin";
    case "location_manager":
      return "Site Manager";
    case "lead":
      return "Lead";
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
      "Everything in the workspace",
      "Change billing plan and seat count",
      "Invite or remove members and set their access level",
      "Transfer ownership",
    ],
    cannot: [],
  },
  admin: {
    label: "Admin",
    underlying: "admin",
    blurb:
      "Full workspace administration across all sites — rosters, timesheets, people, settings.",
    can: [
      "Add / edit employees, locations, areas, shifts",
      "Build, publish and assign the roster everywhere",
      "Approve timesheets, time-off and shift swaps",
      "View Reports and export timesheets",
    ],
    cannot: ["Change billing", "Transfer ownership"],
  },
  location_manager: {
    label: "Site Manager",
    underlying: "location_manager",
    blurb:
      "An Admin restricted to their assigned site(s). Runs the roster, timesheets, and people for those locations only — no billing, workspace settings, or cross-site access.",
    can: [
      "Build / publish the roster and manage shifts at their site(s)",
      "Approve timesheets and time-off at their site(s)",
      "Add / edit employees at their site(s)",
      "Post announcements and tasks",
    ],
    cannot: [
      "Access other sites",
      "Change billing or workspace settings",
      "Manage access levels or scopes",
    ],
  },
  lead: {
    label: "Lead",
    underlying: "lead",
    blurb:
      "A team supervisor scoped to their area(s). Views their team's schedule and approves their team's timesheets — but cannot build or publish the roster, or manage people and settings.",
    can: [
      "View their team's schedule (read-only)",
      "View and approve their team's timesheets",
    ],
    cannot: [
      "Build, publish or assign shifts",
      "Add or edit employees",
      "Access areas outside their assignment",
      "Change settings or manage access levels",
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
    cannot: ["Edit other employees", "Modify the schedule", "Approve timesheets"],
  },
};

/**
 * Numeric rank within the MANAGER hierarchy — owner=2, admin=1,
 * location_manager=1, lead=0, member=0.
 *
 * NOTE: `lead` deliberately ranks 0 (same as member) so it NEVER passes an
 * `isAtLeastManager` gate. A Lead is an approve-only team supervisor, not a
 * roster manager — its (narrower) powers are granted exclusively through the
 * explicit `isLead` / `canApproveTimesheets` / `canViewTeam` predicates below,
 * and scoped to its areas by lib/manager-scope.ts. Keeping lead out of the
 * rank hierarchy is the core safety guarantee: it can't edit the roster or
 * manage people even if a new surface reuses `isAtLeastManager`.
 */
export function roleRank(role: Role | string): number {
  switch (role) {
    case "owner":
      return 2;
    case "admin":
    case "location_manager":
      return 1;
    case "lead":
    case "member":
    default:
      return 0;
  }
}

/**
 * Manager tier — owner, admin, or a (site-scoped) Site Manager. Gates the
 * operational surfaces: roster build/publish/assign, employee CRUD, locations/
 * areas, kiosk, etc. Leads and Employees are excluded.
 */
export function isAtLeastManager(role: Role | string): boolean {
  return roleRank(role) >= 1;
}

/** Owner-only (full workspace control incl. billing, ownership transfer). */
export function isAdmin(role: Role | string): boolean {
  return roleRank(role) >= 2;
}

/**
 * Full, non-scoped workspace administration — owner OR admin, but NOT a Site
 * Manager. Use this to gate surfaces a workspace Admin may reach that a Site
 * Manager must not: workspace settings, integration config, access levels, etc.
 */
export function isWorkspaceAdmin(role: Role | string): boolean {
  return role === "owner" || role === "admin";
}

/** True for the site-scoped Admin tier ("Site Manager"). */
export function isLocationManager(role: Role | string): boolean {
  return role === "location_manager";
}

/** True for the area-scoped, approve-only "Lead" tier. */
export function isLead(role: Role | string): boolean {
  return role === "lead";
}

/**
 * Who may VIEW + APPROVE timesheets: every manager tier, plus a Lead (scoped
 * to their area(s) by lib/manager-scope.ts). Use on the timesheets surfaces in
 * place of `isAtLeastManager`.
 */
export function canApproveTimesheets(role: Role | string): boolean {
  return isAtLeastManager(role) || isLead(role);
}

/**
 * Who may VIEW a team's schedule/timesheets (read-only is enough): managers and
 * Leads. Managers see their location scope; Leads see their area scope.
 */
export function canViewTeam(role: Role | string): boolean {
  return isAtLeastManager(role) || isLead(role);
}
