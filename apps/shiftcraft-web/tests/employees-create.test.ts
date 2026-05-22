import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────
//
// The action under test touches the real DB via @tracey/db and the real
// session via ~/lib/auth/current. We replace both with controllable doubles
// so we can assert the action's branching (Zod validation, the email-dedup
// precheck, the conditional notification fan-out) without standing up a
// Postgres or Auth.js harness.

const state = {
  existingEmployees: [] as Array<{ id: string; email: string | null; traceyTenantId: string }>,
  inserted: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: unknown; set: Record<string, unknown> }>,
  deleted: 0,
  lastTenantIdForTenant: undefined as string | undefined,
  notifyCalls: [] as Array<{
    tenantId: string;
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }>,
};

function resetState() {
  state.existingEmployees = [];
  state.inserted = [];
  state.updates = [];
  state.deleted = 0;
  state.lastTenantIdForTenant = undefined;
  state.notifyCalls = [];
}

vi.mock("@tracey/db", () => {
  const TABLE_EMPLOYEES = Symbol("scEmployees");
  const TABLE_DEPARTMENTS = Symbol("scDepartments");
  const scEmployees = {
    __table: TABLE_EMPLOYEES,
    traceyTenantId: { __field: "traceyTenantId" },
    email: { __field: "email" },
    id: { __field: "id" },
    departmentId: { __field: "departmentId" },
  };
  const scDepartments = {
    __table: TABLE_DEPARTMENTS,
    traceyTenantId: { __field: "traceyTenantId" },
    name: { __field: "name" },
    id: { __field: "id" },
  };
  type AnyTable = typeof scEmployees | typeof scDepartments;
  // Added with the auto-link fix (2026-05-22): actions.ts now imports
  // `users` and `members` and runs a select against the shared `app`
  // schema to find the auth user whose email matches the form's email.
  // Mock returns an empty result by default so the create/update path
  // leaves app_user_id null, matching pre-fix behaviour under test.
  const users = {
    __table: "users",
    id: { __field: "id" },
    email: { __field: "email" },
  };
  const members = {
    __table: "members",
    userId: { __field: "userId" },
    tenantId: { __field: "tenantId" },
    role: { __field: "role" },
  };
  return {
    scEmployees,
    scEmployeePins: { __table: "scEmployeePins" },
    scDepartments,
    auditEvents: { __table: "auditEvents" },
    users,
    members,
    db: {
      insert: () => ({
        values: async () => [],
      }),
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => [],
            }),
          }),
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => [],
        }),
      }),
    },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        state.lastTenantIdForTenant = tenantId;
        const tx = {
          select: () => ({
            from: (table: AnyTable) => ({
              where: () => ({
                limit: async () => {
                  // Email-dedup precheck on sc_employees uses the seeded
                  // `existingEmployees`. sc_departments lookups always
                  // return empty so resolveDepartmentId falls through to
                  // the insert branch.
                  if (table.__table === TABLE_EMPLOYEES) {
                    return state.existingEmployees
                      .filter((r) => r.traceyTenantId === tenantId)
                      .slice(0, 1);
                  }
                  return [];
                },
              }),
            }),
          }),
          insert: (table: AnyTable) => ({
            values: (values: Record<string, unknown>) => {
              // .returning() path used by resolveDepartmentId; the bare
              // await path used by employees insert.
              const chain = {
                async returning() {
                  if (table.__table === TABLE_DEPARTMENTS) {
                    return [{ id: `dept-${state.inserted.length + 1}` }];
                  }
                  state.inserted.push(values);
                  return [{ id: `inserted-${state.inserted.length}` }];
                },
                then(
                  onF: (v: Array<{ id: string }>) => unknown,
                  onR?: (e: unknown) => unknown,
                ) {
                  if (table.__table === TABLE_DEPARTMENTS) {
                    return Promise.resolve([
                      { id: `dept-${state.inserted.length + 1}` },
                    ]).then(onF, onR);
                  }
                  state.inserted.push(values);
                  return Promise.resolve([
                    { id: `inserted-${state.inserted.length}` },
                  ]).then(onF, onR);
                },
              };
              return chain;
            },
          }),
          update: () => ({
            set: (patch: Record<string, unknown>) => ({
              where: async (w: unknown) => {
                state.updates.push({ where: w, set: patch });
                return [{ id: "updated" }];
              },
            }),
          }),
          delete: () => ({
            where: async () => {
              state.deleted += 1;
              return [{ id: "deleted" }];
            },
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => ({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  })),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
}));

vi.mock("~/lib/notifications", () => ({
  notifyTenantAdmins: vi.fn(
    async (
      tenantId: string,
      input: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      state.notifyCalls.push({ tenantId, input, options });
    },
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    // Mirror Next.js's behaviour: redirect throws so callers can't fall through.
    const e = new Error(`NEXT_REDIRECT: ${url}`);
    (e as Error & { __redirect?: string }).__redirect = url;
    throw e;
  }),
}));

// Lazy import so the mocks above are set up first.
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

describe("createEmployeeAction", () => {
  it("inserts a permanent employee and notifies admins when email is provided", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          mobile: "0400 000 000",
          department: "Butchery",
          employmentType: "permanent",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      fullName: "Jane Doe",
      email: "jane@example.com",
      mobile: "0400 000 000",
      employmentType: "permanent",
      traceyTenantId: "tenant-A",
      createdByUserId: "user-1",
    });
    // department is now a typed FK — the mock returns a fake dept id
    // from the insert .returning() path, which the action threads in
    // as `departmentId`.
    expect(state.inserted[0]!.departmentId).toMatch(/^dept-/);
    expect(state.notifyCalls).toHaveLength(1);
    expect(state.notifyCalls[0]).toMatchObject({
      tenantId: "tenant-A",
      input: {
        kind: "shiftcraft_employee_added",
        actionUrl: "/app/admin/employees",
      },
      options: { excludeUserId: "user-1" },
    });
  });

  it("rejects a duplicate email within the same tenant via the precheck", async () => {
    state.existingEmployees = [
      { id: "x", email: "jane@example.com", traceyTenantId: "tenant-A" },
    ];
    const { createEmployeeAction } = await load();
    const result = await createEmployeeAction(
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "jane@example.com",
        employmentType: "permanent",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.email?.[0]).toMatch(/already exists/i);
    }
    expect(state.inserted).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("accepts a labour-hire row with no email and skips the LMS suggestion", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Contractor A",
          email: "",
          mobile: "0400 111 222",
          employmentType: "labour_hire",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      fullName: "Contractor A",
      email: null,
      employmentType: "labour_hire",
    });
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("does not fire the LMS suggestion when email is set but type is labour_hire", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Contractor B",
          email: "contractor@example.com",
          employmentType: "labour_hire",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.inserted).toHaveLength(1);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("passes the caller's tenant id to forTenant so per-tenant isolation kicks in", async () => {
    // Sanity check that the action does not run unscoped against the shared
    // pool — the search_path setting inside forTenant() is the mechanism that
    // routes the query to tenant_<uuid>.sc_employees rather than public.
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "scoped@example.com",
          employmentType: "casual",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    expect(state.lastTenantIdForTenant).toBe("tenant-A");
  });

  it("returns a field error for an invalid email format", async () => {
    const { createEmployeeAction } = await load();
    const result = await createEmployeeAction(
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "not-an-email",
        employmentType: "permanent",
      }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.email).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("persists hourly_rate when provided", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          hourlyRate: "24.50",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted[0]!.hourlyRate).toBe("24.50");
  });

  it("rejects a non-numeric hourly_rate", async () => {
    const { createEmployeeAction } = await load();
    const r = await createEmployeeAction(
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "jane@example.com",
        employmentType: "permanent",
        hourlyRate: "not a number",
      }),
    );
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.fieldErrors?.hourlyRate).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });

  it("treats a blank hourly_rate as null (no error)", async () => {
    const { createEmployeeAction } = await load();
    await expect(
      createEmployeeAction(
        { status: "idle" },
        fd({
          fullName: "Jane Doe",
          email: "jane@example.com",
          employmentType: "permanent",
          hourlyRate: "",
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserted[0]!.hourlyRate).toBeNull();
  });
});

describe("updateEmployeeAction", () => {
  it("updates rate + other fields on an existing row", async () => {
    const { updateEmployeeAction } = await load();
    const r = await updateEmployeeAction(
      "emp-1",
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "jane@example.com",
        employmentType: "permanent",
        hourlyRate: "30.00",
        department: "Butchery",
      }),
    );
    expect(r.status).toBe("ok");
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]!.set).toMatchObject({
      fullName: "Jane Doe",
      hourlyRate: "30.00",
    });
    // The action resolves the typed department FK, so the patch carries
    // a departmentId (UUID) rather than a free-text `department`.
    expect(state.updates[0]!.set.departmentId).toMatch(/^dept-/);
  });

  it("rejects an invalid email on edit", async () => {
    const { updateEmployeeAction } = await load();
    const r = await updateEmployeeAction(
      "emp-1",
      { status: "idle" },
      fd({
        fullName: "Jane Doe",
        email: "garbage",
        employmentType: "permanent",
      }),
    );
    expect(r.status).toBe("error");
    expect(state.updates).toHaveLength(0);
  });
});

describe("deleteEmployeeAction", () => {
  it("deletes the row scoped to the tenant", async () => {
    const { deleteEmployeeAction } = await load();
    await expect(deleteEmployeeAction(fd({ id: "emp-1" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect(state.deleted).toBe(1);
  });

  it("is a no-op on empty id", async () => {
    const { deleteEmployeeAction } = await load();
    await deleteEmployeeAction(fd({ id: "" }));
    expect(state.deleted).toBe(0);
  });
});
