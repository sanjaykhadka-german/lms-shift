import { describe, it, expect, vi, beforeEach } from "vitest";

interface ScopeRow {
  locationId: string;
}

const state = {
  rows: [] as ScopeRow[],
  lastTenantId: null as string | null,
  lastUserId: null as string | null,
};

function reset() {
  state.rows = [];
  state.lastTenantId = null;
  state.lastUserId = null;
}

vi.mock("@tracey/db", () => ({
  scManagerLocations: {
    traceyTenantId: { __field: "traceyTenantId" },
    appUserId: { __field: "appUserId" },
    locationId: { __field: "locationId" },
  },
  forTenant: (tid: string) => ({
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(state.rows),
          }),
        }),
      };
      return fn(tx);
    },
  }),
}));

const { getManagedLocationIds, isLocationInScope, scopeArray } = await import(
  "~/lib/manager-scope"
);

beforeEach(() => reset());

describe("getManagedLocationIds", () => {
  it("returns null for owners (no restriction)", async () => {
    state.rows = [{ locationId: "loc-1" }]; // even with rows, owners pass
    const scope = await getManagedLocationIds("tenant-A", "user-1", "owner");
    expect(scope).toBeNull();
  });

  it("returns null for members (gated elsewhere)", async () => {
    state.rows = [{ locationId: "loc-1" }];
    const scope = await getManagedLocationIds("tenant-A", "user-1", "member");
    expect(scope).toBeNull();
  });

  it("returns null for admins with no rows (backwards-compat: full access)", async () => {
    state.rows = [];
    const scope = await getManagedLocationIds("tenant-A", "user-1", "admin");
    expect(scope).toBeNull();
  });

  it("returns a Set of location IDs for admins with rows", async () => {
    state.rows = [{ locationId: "loc-1" }, { locationId: "loc-2" }];
    const scope = await getManagedLocationIds("tenant-A", "user-1", "admin");
    expect(scope).toBeInstanceOf(Set);
    expect(scope?.size).toBe(2);
    expect(scope?.has("loc-1")).toBe(true);
    expect(scope?.has("loc-2")).toBe(true);
  });

  it("dedupes identical location IDs (defensive)", async () => {
    state.rows = [
      { locationId: "loc-1" },
      { locationId: "loc-1" }, // shouldn't happen given the unique index
      { locationId: "loc-2" },
    ];
    const scope = await getManagedLocationIds("tenant-A", "user-1", "admin");
    expect(scope?.size).toBe(2);
  });
});

describe("isLocationInScope", () => {
  it("passes any location when scope is null", () => {
    expect(isLocationInScope(null, "loc-anything")).toBe(true);
    expect(isLocationInScope(null, null)).toBe(true);
  });

  it("rejects unknown location when scope is set", () => {
    const scope = new Set(["loc-1", "loc-2"]);
    expect(isLocationInScope(scope, "loc-3")).toBe(false);
  });

  it("accepts a location in the scope set", () => {
    const scope = new Set(["loc-1", "loc-2"]);
    expect(isLocationInScope(scope, "loc-2")).toBe(true);
  });

  it("rejects null locationId when scope is set (can't grant access to 'nowhere')", () => {
    const scope = new Set(["loc-1"]);
    expect(isLocationInScope(scope, null)).toBe(false);
    expect(isLocationInScope(scope, undefined)).toBe(false);
  });
});

describe("scopeArray", () => {
  it("returns null for null scope", () => {
    expect(scopeArray(null)).toBeNull();
  });

  it("returns the Set's contents for an array-shape SQL ANY() clause", () => {
    const arr = scopeArray(new Set(["loc-1", "loc-2"]));
    expect(arr).toEqual(expect.arrayContaining(["loc-1", "loc-2"]));
    expect(arr).toHaveLength(2);
  });
});
