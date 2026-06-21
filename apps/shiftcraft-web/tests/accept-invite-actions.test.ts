import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// acceptInvitationAction touches the shared `app` schema via `db` (invitations
// / members / users) and the per-tenant `sc_employees` table via forTenant().
// We double both so we can assert the roster back-fill (the fix) without a
// Postgres harness: when the invitee accepts, the action must set
// sc_employees.app_user_id = the invitee's user id, scoped to the tenant and
// matched by email.

const state = {
  invitation: null as null | {
    id: string;
    token: string;
    email: string;
    tenantId: string;
    role: string;
    expiresAt: Date;
  },
  existingMembers: [] as Array<{ id: string }>,
  insertedMembers: [] as Array<Record<string, unknown>>,
  // Captured set/where from the per-tenant sc_employees update (the fix).
  employeeUpdates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  lastTenantIdForTenant: undefined as string | undefined,
  deletedInvitations: 0,
  activeTenantSetTo: undefined as string | undefined,
  auditCalls: [] as Array<Record<string, unknown>>,
};

function resetState() {
  state.invitation = null;
  state.existingMembers = [];
  state.insertedMembers = [];
  state.employeeUpdates = [];
  state.lastTenantIdForTenant = undefined;
  state.deletedInvitations = 0;
  state.activeTenantSetTo = undefined;
  state.auditCalls = [];
}

vi.mock("@tracey/db", () => {
  const TABLE_INVITATIONS = Symbol("invitations");
  const TABLE_MEMBERS = Symbol("members");
  const TABLE_USERS = Symbol("users");
  const invitations = {
    __table: TABLE_INVITATIONS,
    token: { __field: "token" },
    id: { __field: "id" },
  };
  const members = {
    __table: TABLE_MEMBERS,
    tenantId: { __field: "tenantId" },
    userId: { __field: "userId" },
    id: { __field: "id" },
  };
  const users = {
    __table: TABLE_USERS,
    id: { __field: "id" },
    email: { __field: "email" },
    emailVerified: { __field: "emailVerified" },
  };
  const scEmployees = {
    __table: "scEmployees",
    traceyTenantId: { __field: "traceyTenantId" },
    appUserId: { __field: "appUserId" },
    email: { __field: "email" },
  };
  return {
    invitations,
    members,
    users,
    scEmployees,
    db: {
      select: () => ({
        from: (table: { __table: symbol }) => ({
          where: () => ({
            limit: async () => {
              if (table.__table === TABLE_INVITATIONS) {
                return state.invitation ? [state.invitation] : [];
              }
              if (table.__table === TABLE_MEMBERS) {
                return state.existingMembers;
              }
              return [];
            },
          }),
        }),
      }),
      insert: (table: { __table: symbol }) => ({
        values: async (values: Record<string, unknown>) => {
          if (table.__table === TABLE_MEMBERS) state.insertedMembers.push(values);
          return [];
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
      delete: (table: { __table: symbol }) => ({
        where: async () => {
          if (table.__table === TABLE_INVITATIONS) state.deletedInvitations += 1;
          return [];
        },
      }),
    },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        state.lastTenantIdForTenant = tenantId;
        const tx = {
          update: () => ({
            set: (patch: Record<string, unknown>) => ({
              where: async (w: unknown) => {
                state.employeeUpdates.push({ set: patch, where: w });
                return [];
              },
            }),
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentUser: vi.fn(async () => ({
    id: "user-99",
    email: "Newhire@Example.com",
    name: "New Hire",
    image: null,
  })),
  setActiveTenant: vi.fn(async (tenantId: string) => {
    state.activeTenantSetTo = tenantId;
  }),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT: ${url}`);
    (e as Error & { __redirect?: string }).__redirect = url;
    throw e;
  }),
}));

async function load() {
  return await import("../app/accept-invite/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
  state.invitation = {
    id: "inv-1",
    token: "tok-1",
    email: "newhire@example.com",
    tenantId: "tenant-A",
    role: "member",
    expiresAt: new Date(Date.now() + 60_000),
  };
});

describe("acceptInvitationAction", () => {
  it("back-fills sc_employees.app_user_id for the accepting user, scoped to the tenant", async () => {
    const { acceptInvitationAction } = await load();
    await expect(
      acceptInvitationAction(fd({ token: "tok-1" })),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app/);

    expect(state.insertedMembers).toHaveLength(1);
    // The fix: exactly one per-tenant employee update, linking app_user_id.
    expect(state.lastTenantIdForTenant).toBe("tenant-A");
    expect(state.employeeUpdates).toHaveLength(1);
    expect(state.employeeUpdates[0]!.set).toMatchObject({ appUserId: "user-99" });
    expect(state.deletedInvitations).toBe(1);
    expect(state.activeTenantSetTo).toBe("tenant-A");
  });

  it("is idempotent on an existing membership but still attempts the link", async () => {
    state.existingMembers = [{ id: "m-1" }];
    const { acceptInvitationAction } = await load();
    await expect(
      acceptInvitationAction(fd({ token: "tok-1" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.insertedMembers).toHaveLength(0);
    expect(state.employeeUpdates).toHaveLength(1);
    expect(state.employeeUpdates[0]!.set).toMatchObject({ appUserId: "user-99" });
  });

  it("rejects when the invitation email does not match the signed-in account", async () => {
    state.invitation = {
      id: "inv-2",
      token: "tok-2",
      email: "someone-else@example.com",
      tenantId: "tenant-A",
      role: "member",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const { acceptInvitationAction } = await load();
    await expect(
      acceptInvitationAction(fd({ token: "tok-2" })),
    ).rejects.toThrow(/does not match/i);
    expect(state.employeeUpdates).toHaveLength(0);
  });
});
