import { beforeEach, describe, expect, it, vi } from "vitest";

// Focuses on the new invite-on-create gate in createEmployeeAction
// (AUDIT.md Phase 2 #2b). The employee row insert is exercised in
// employees-create.test.ts — here we assert ONLY the invite branches:
// when an invitation row is written + email sent vs skipped.

const state = {
  existingMembers: [] as Array<{ email: string; tenantId: string }>,
  existingInvites: [] as Array<{ email: string; tenantId: string }>,
  invitesInserted: [] as Array<Record<string, unknown>>,
  invitesDeletedByToken: [] as string[],
  emailsSent: [] as Array<{
    to: string;
    token: string;
    tenantName: string;
    inviterName: string | null;
  }>,
  audits: [] as Array<{
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
  shouldEmailFail: false,
};

function resetState() {
  state.existingMembers = [];
  state.existingInvites = [];
  state.invitesInserted = [];
  state.invitesDeletedByToken = [];
  state.emailsSent = [];
  state.audits = [];
  state.shouldEmailFail = false;
}

vi.mock("@tracey/db", () => {
  const TABLE_INVITATIONS = Symbol("invitations");
  const TABLE_USERS_MEMBERS = Symbol("users_members");
  const scEmployees = {
    __table: "scEmployees",
    traceyTenantId: { __field: "traceyTenantId" },
    email: { __field: "email" },
    id: { __field: "id" },
    departmentId: { __field: "departmentId" },
  };
  const scDepartments = {
    __table: "scDepartments",
    traceyTenantId: { __field: "traceyTenantId" },
    name: { __field: "name" },
    id: { __field: "id" },
  };
  const invitations = {
    __table: TABLE_INVITATIONS,
    id: { __field: "id" },
    tenantId: { __field: "tenantId" },
    email: { __field: "email" },
    token: { __field: "token" },
  };
  const users = {
    __table: TABLE_USERS_MEMBERS,
    id: { __field: "id" },
    email: { __field: "email" },
  };
  const members = {
    __table: TABLE_USERS_MEMBERS,
    userId: { __field: "userId" },
    tenantId: { __field: "tenantId" },
    role: { __field: "role" },
  };
  type SelectChain = {
    from: (table: { __table: unknown }) => {
      innerJoin: (otherTable: { __table: unknown }) => {
        where: (whereExpr: unknown) => {
          limit: () => Promise<unknown[]>;
        };
      };
      where: (whereExpr: unknown) => {
        limit: () => Promise<unknown[]>;
      };
    };
  };
  // Track the most recent select's "context" (which table + reads we set
  // up). The mock chains are very loose — we drive returns by looking at
  // what table was passed to .from().
  let lastFromTable: unknown = null;
  return {
    scEmployees,
    scEmployeePins: { __table: "scEmployeePins" },
    scDepartments,
    auditEvents: { __table: "auditEvents" },
    users,
    members,
    invitations,
    db: {
      insert: (table: { __table: unknown }) => ({
        values: (values: Record<string, unknown>) => {
          if (table.__table === TABLE_INVITATIONS) {
            state.invitesInserted.push(values);
            return {
              async returning() {
                return [{ id: `inv-${state.invitesInserted.length}` }];
              },
            };
          }
          // Other inserts (auditEvents etc.) — return a thenable async
          // resolving to [].
          return {
            async returning() {
              return [];
            },
            then(onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve([]).then(onF, onR);
            },
          };
        },
      }),
      select: (): SelectChain => ({
        from: (table) => {
          lastFromTable = table.__table;
          return {
            innerJoin: () => ({
              where: () => ({
                async limit() {
                  // findAppUserIdByTenantEmail — returns matches when the
                  // mock has been seeded with an existing member.
                  if (lastFromTable === TABLE_USERS_MEMBERS) {
                    if (state.existingMembers.length > 0) {
                      return [{ userId: "user-existing" }];
                    }
                    return [];
                  }
                  return [];
                },
              }),
            }),
            where: () => ({
              async limit() {
                if (lastFromTable === TABLE_INVITATIONS) {
                  if (state.existingInvites.length > 0) {
                    return [{ id: "invite-existing" }];
                  }
                  return [];
                }
                return [];
              },
            }),
          };
        },
      }),
      update: () => ({
        set: () => ({ where: async () => [] }),
      }),
      delete: (table: { __table: unknown }) => ({
        where: (whereExpr: { __token?: string }) => {
          if (table.__table === TABLE_INVITATIONS) {
            // The action passes eq(invitations.token, token) — we tag the
            // expression with the token in the eq() helper below so the
            // delete can record exactly which invite was rolled back. But
            // since we don't mock drizzle's eq, we just record a delete
            // with the most recently inserted token (the rollback path
            // always references the just-issued token).
            const latest = state.invitesInserted.at(-1);
            if (latest && typeof latest.token === "string") {
              state.invitesDeletedByToken.push(latest.token);
            }
          }
          return Promise.resolve([]);
        },
      }),
    },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => [],
              }),
            }),
          }),
          insert: () => ({
            values: () => {
              const chain = {
                async returning() {
                  return [{ id: `inserted-1` }];
                },
                then(onF: (v: unknown[]) => unknown, onR?: (e: unknown) => unknown) {
                  return Promise.resolve([{ id: `inserted-1` }]).then(onF, onR);
                },
              };
              return chain;
            },
          }),
          update: () => ({ set: () => ({ where: async () => [] }) }),
          delete: () => ({ where: async () => [] }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => ({
    tenant: { id: "tenant-A", name: "Acme Corp" },
    role: "admin",
  })),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Alice Admin",
    image: null,
  })),
}));

vi.mock("~/lib/auth/email", () => ({
  sendInvitationEmail: vi.fn(async (opts: {
    to: string;
    token: string;
    tenantName: string;
    inviterName: string | null;
  }) => {
    if (state.shouldEmailFail) {
      throw new Error("simulated SMTP failure");
    }
    state.emailsSent.push(opts);
  }),
}));

vi.mock("~/lib/auth/tokens", () => ({
  generateToken: vi.fn(() => "deterministic-test-token"),
  tokenExpiry: vi.fn((hours: number) => new Date(Date.now() + hours * 3600_000)),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: { action: string; targetId?: string | null; details?: Record<string, unknown> | null }) => {
    state.audits.push(input);
  }),
}));

vi.mock("~/lib/notifications", () => ({ notifyTenantAdmins: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const e = new Error(`NEXT_REDIRECT: ${url}`);
    (e as Error & { __redirect?: string }).__redirect = url;
    throw e;
  }),
}));

async function load() {
  return await import("../app/app/employees/new/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
});

describe("createEmployeeAction — invite gate", () => {
  it("sends an invitation when sendInvite is on, email is set, and the user is not yet a member", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1&invited=1/);

    expect(state.invitesInserted).toHaveLength(1);
    expect(state.invitesInserted[0]).toMatchObject({
      tenantId: "tenant-A",
      email: "jane@example.com",
      role: "member",
      token: "deterministic-test-token",
      invitedByUserId: "user-1",
    });
    expect(state.emailsSent).toHaveLength(1);
    expect(state.emailsSent[0]).toMatchObject({
      to: "jane@example.com",
      token: "deterministic-test-token",
      tenantName: "Acme Corp",
      inviterName: "Alice Admin",
    });
    const invited = state.audits.find((a) => a.action === "tenant.member.invited");
    expect(invited).toBeDefined();
    expect(invited!.details).toMatchObject({
      email: "jane@example.com",
      role: "member",
      source: "shiftcraft.employee_create",
    });
  });

  it("skips the invite when the checkbox is off, even with an email", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          // sendInvite intentionally omitted — unchecked checkbox
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1$/);

    expect(state.invitesInserted).toHaveLength(0);
    expect(state.emailsSent).toHaveLength(0);
    expect(
      state.audits.some((a) => a.action === "tenant.member.invited"),
    ).toBe(false);
  });

  it("skips the invite for labour_hire even with checkbox + email", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Contractor C",
          email: "c@agency.example",
          employmentType: "labour_hire",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1$/);

    expect(state.invitesInserted).toHaveLength(0);
    expect(state.emailsSent).toHaveLength(0);
  });

  it("skips the invite when the email is empty", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "No Email Person",
          email: "",
          employmentType: "casual",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.invitesInserted).toHaveLength(0);
    expect(state.emailsSent).toHaveLength(0);
  });

  it("skips the invite when the email already belongs to a tenant member (auto-link covers it)", async () => {
    state.existingMembers = [{ email: "jane@example.com", tenantId: "tenant-A" }];
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1$/);

    expect(state.invitesInserted).toHaveLength(0);
    expect(state.emailsSent).toHaveLength(0);
  });

  it("skips the invite (no duplicate row) when a pending invitation already exists", async () => {
    state.existingInvites = [{ email: "jane@example.com", tenantId: "tenant-A" }];
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1$/);

    expect(state.invitesInserted).toHaveLength(0);
    expect(state.emailsSent).toHaveLength(0);
  });

  it("rolls back the invitation row and still completes the redirect when the email send fails", async () => {
    state.shouldEmailFail = true;
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          sendInvite: "on",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT: \/app\/employees\?added=1$/);

    // Row inserted then deleted by token → no lingering pending invite.
    expect(state.invitesInserted).toHaveLength(1);
    expect(state.invitesDeletedByToken).toEqual(["deterministic-test-token"]);
    // And critically, no audit event recorded — the action only logs on
    // successful send.
    expect(
      state.audits.some((a) => a.action === "tenant.member.invited"),
    ).toBe(false);
  });
});
