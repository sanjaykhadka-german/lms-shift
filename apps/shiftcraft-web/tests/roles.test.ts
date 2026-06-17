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
  roleRank,
  ROLE_DESCRIPTIONS,
} = await import("../lib/roles");

describe("friendlyRoleLabel", () => {
  it("maps owner → Admin", () => {
    expect(friendlyRoleLabel("owner")).toBe("Admin");
  });
  it("maps admin → Manager", () => {
    expect(friendlyRoleLabel("admin")).toBe("Manager");
  });
  it("maps location_manager → Location Manager", () => {
    expect(friendlyRoleLabel("location_manager")).toBe("Location Manager");
  });
  it("maps member → Employee", () => {
    expect(friendlyRoleLabel("member")).toBe("Employee");
  });
  it("falls back to Employee for unknown roles", () => {
    expect(friendlyRoleLabel("garbage")).toBe("Employee");
  });
});

describe("roleRank", () => {
  it("ranks owner > admin > member", () => {
    expect(roleRank("owner")).toBe(2);
    expect(roleRank("admin")).toBe(1);
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
  it("admin is at-least-manager but NOT admin-tier", () => {
    // "Admin" the friendly label maps to the underlying "owner" tier.
    // The Tracey-side "admin" role is the Manager tier in our UI.
    expect(isAdmin("admin")).toBe(false);
    expect(isAtLeastManager("admin")).toBe(true);
  });
  it("member is neither", () => {
    expect(isAdmin("member")).toBe(false);
    expect(isAtLeastManager("member")).toBe(false);
  });
});

describe("location_manager tier", () => {
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

describe("ROLE_DESCRIPTIONS", () => {
  it("has an entry per Tracey role with matching friendly label", () => {
    for (const role of ["owner", "admin", "location_manager", "member"] as const) {
      const d = ROLE_DESCRIPTIONS[role];
      expect(d.underlying).toBe(role);
      expect(d.label).toBe(friendlyRoleLabel(role));
      expect(d.can.length).toBeGreaterThan(0);
    }
  });

  it("Admin tier has no 'cannot' restrictions (owners can do everything)", () => {
    expect(ROLE_DESCRIPTIONS.owner.cannot).toHaveLength(0);
  });

  it("Manager tier explicitly cannot change billing", () => {
    const cannot = ROLE_DESCRIPTIONS.admin.cannot.join(" ").toLowerCase();
    expect(cannot).toContain("billing");
  });
});
