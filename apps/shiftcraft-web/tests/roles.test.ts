import { describe, it, expect, vi } from "vitest";

// Stub @tracey/db before importing lib/roles — the role helper only uses
// the Role *type* from @tracey/db, but Node's module loader still
// evaluates the package's index.ts which throws on missing DATABASE_URL.
vi.mock("@tracey/db", () => ({}));

const {
  friendlyRoleLabel,
  isAdmin,
  isAtLeastManager,
  isWorkspaceAdmin,
  isLocationManager,
  isLead,
  canApproveTimesheets,
  canViewTeam,
  roleRank,
  ROLE_DESCRIPTIONS,
} = await import("../lib/roles");

describe("friendlyRoleLabel", () => {
  it("maps owner → Admin", () => {
    expect(friendlyRoleLabel("owner")).toBe("Admin");
  });
  it("maps admin → Admin (folded with owner)", () => {
    expect(friendlyRoleLabel("admin")).toBe("Admin");
  });
  it("maps location_manager → Site Manager", () => {
    expect(friendlyRoleLabel("location_manager")).toBe("Site Manager");
  });
  it("maps lead → Lead", () => {
    expect(friendlyRoleLabel("lead")).toBe("Lead");
  });
  it("maps member → Employee", () => {
    expect(friendlyRoleLabel("member")).toBe("Employee");
  });
  it("falls back to Employee for unknown roles", () => {
    expect(friendlyRoleLabel("garbage")).toBe("Employee");
  });
});

describe("roleRank", () => {
  it("ranks owner > admin/location_manager > lead/member", () => {
    expect(roleRank("owner")).toBe(2);
    expect(roleRank("admin")).toBe(1);
    expect(roleRank("location_manager")).toBe(1);
    expect(roleRank("lead")).toBe(0);
    expect(roleRank("member")).toBe(0);
  });
  it("treats unknown roles as the lowest tier", () => {
    expect(roleRank("garbage")).toBe(0);
  });
});

describe("isAdmin / isAtLeastManager", () => {
  it("owner is both admin and at-least-manager", () => {
    expect(isAdmin("owner")).toBe(true);
    expect(isAtLeastManager("owner")).toBe(true);
  });
  it("admin is at-least-manager but NOT owner-tier", () => {
    expect(isAdmin("admin")).toBe(false);
    expect(isAtLeastManager("admin")).toBe(true);
  });
  it("member is neither", () => {
    expect(isAdmin("member")).toBe(false);
    expect(isAtLeastManager("member")).toBe(false);
  });
});

describe("location_manager (Site Manager) tier", () => {
  it("ranks at the Manager tier (1)", () => {
    expect(roleRank("location_manager")).toBe(1);
  });
  it("is at-least-manager (passes operational gates) but not owner-tier", () => {
    expect(isAtLeastManager("location_manager")).toBe(true);
    expect(isAdmin("location_manager")).toBe(false);
  });
  it("is NOT a workspace admin (blocked from billing / workspace settings)", () => {
    expect(isWorkspaceAdmin("location_manager")).toBe(false);
    expect(isWorkspaceAdmin("owner")).toBe(true);
    expect(isWorkspaceAdmin("admin")).toBe(true);
    expect(isWorkspaceAdmin("member")).toBe(false);
  });
  it("isLocationManager identifies only the new tier", () => {
    expect(isLocationManager("location_manager")).toBe(true);
    expect(isLocationManager("admin")).toBe(false);
    expect(isLocationManager("owner")).toBe(false);
  });
});

describe("lead (Lead) tier — approve-only, never a manager", () => {
  it("is NOT a manager and NOT an admin (no roster/people/settings access)", () => {
    expect(isAtLeastManager("lead")).toBe(false);
    expect(isAdmin("lead")).toBe(false);
    expect(isWorkspaceAdmin("lead")).toBe(false);
    expect(roleRank("lead")).toBe(0);
  });
  it("isLead identifies only the lead role", () => {
    expect(isLead("lead")).toBe(true);
    expect(isLead("location_manager")).toBe(false);
    expect(isLead("member")).toBe(false);
  });
  it("CAN approve timesheets and view the team", () => {
    expect(canApproveTimesheets("lead")).toBe(true);
    expect(canViewTeam("lead")).toBe(true);
  });
});

describe("canApproveTimesheets / canViewTeam", () => {
  it("true for managers and leads, false for plain employees", () => {
    for (const r of ["owner", "admin", "location_manager", "lead"]) {
      expect(canApproveTimesheets(r)).toBe(true);
      expect(canViewTeam(r)).toBe(true);
    }
    expect(canApproveTimesheets("member")).toBe(false);
    expect(canViewTeam("member")).toBe(false);
  });
});

describe("ROLE_DESCRIPTIONS", () => {
  it("has an entry per Tracey role with matching friendly label", () => {
    for (const role of [
      "owner",
      "admin",
      "location_manager",
      "lead",
      "member",
    ] as const) {
      const d = ROLE_DESCRIPTIONS[role];
      expect(d.underlying).toBe(role);
      expect(d.label).toBe(friendlyRoleLabel(role));
      expect(d.can.length).toBeGreaterThan(0);
    }
  });

  it("owner (account-owner Admin) has no 'cannot' restrictions", () => {
    expect(ROLE_DESCRIPTIONS.owner.cannot).toHaveLength(0);
  });

  it("the Lead tier cannot build/publish the roster", () => {
    const cannot = ROLE_DESCRIPTIONS.lead.cannot.join(" ").toLowerCase();
    expect(cannot).toContain("publish");
  });
});
