import { describe, it, expect, beforeEach, vi } from "vitest";

const SHIFT_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

interface LeaveRow {
  requestId: string;
  startDate: string;
  endDate: string;
  leaveTypeName: string | null;
  userId: string;
}

const state = {
  shift: null as
    | null
    | {
        startsAt: Date;
        endsAt: Date;
        role: string;
        locationName: string | null;
      },
  leaveRows: [] as LeaveRow[],
  inserts: [] as Array<{ shiftId: string; userId: string }>,
  emailSends: [] as Array<{ email: string; name: string | null }>,
  selectIdx: 0,
};

const currentMembershipMock = vi.fn();

// assignEmployeeAction performs two forTenant().run() selects before any
// insert: (1) shift lookup, (2) leave-overlap check. Track which one
// the harness is serving.
const TENANT_SELECTS = ["shift", "leave"] as const;

function reset() {
  state.shift = {
    startsAt: new Date("2026-06-05T08:00:00Z"),
    endsAt: new Date("2026-06-05T16:00:00Z"),
    role: "Butcher",
    locationName: "Brunswick",
  };
  state.leaveRows = [];
  state.inserts = [];
  state.emailSends = [];
  state.selectIdx = 0;
}

vi.mock("@tracey/db", () => {
  const cols = (fields: string[]) =>
    Object.fromEntries(fields.map((f) => [f, { __field: f }])) as Record<
      string,
      { __field: string }
    >;
  return {
    scShifts: cols([
      "id",
      "traceyTenantId",
      "startsAt",
      "endsAt",
      "role",
      "status",
    ]),
    scLocations: cols(["id", "name"]),
    scShiftAssignments: cols(["id", "shiftId", "userId", "status"]),
    scLeaveTypes: cols(["id", "name"]),
    scTimeOffRequests: cols([
      "id",
      "traceyTenantId",
      "userId",
      "startDate",
      "endDate",
      "status",
      "leaveTypeId",
    ]),
    scEmployees: cols(["id"]),
    scDepartments: cols(["id"]),
    users: cols(["id", "name", "email"]),
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              { id: USER_ID, email: "alice@example.com", name: "Alice" },
            ],
          }),
        }),
      }),
    },
    forTenant: () => ({
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: () => {
            const which = TENANT_SELECTS[state.selectIdx] ?? "unknown";
            state.selectIdx += 1;
            const rows: unknown[] =
              which === "shift"
                ? state.shift
                  ? [state.shift]
                  : []
                : which === "leave"
                  ? state.leaveRows
                  : [];
            const whereChain = {
              limit: async () => rows,
              then(
                onF: (v: unknown[]) => unknown,
                onR?: (e: unknown) => unknown,
              ) {
                return Promise.resolve(rows).then(onF, onR);
              },
            };
            return {
              from: () => ({
                leftJoin: () => ({
                  where: () => whereChain,
                }),
                where: () => whereChain,
              }),
            };
          },
          insert: () => ({
            values: (v: { shiftId: string; userId: string }) => {
              state.inserts.push(v);
              return Promise.resolve();
            },
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: () => currentMembershipMock(),
  currentUser: vi.fn(async () => ({
    id: "user-admin",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
  requireUser: vi.fn(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("~/lib/email", () => ({
  notifyShiftOffered: vi.fn(
    async (opts: { to: { email: string; name: string | null } }) => {
      state.emailSends.push(opts.to);
    },
  ),
  notifyShiftScheduled: vi.fn(
    async (opts: { to: { email: string; name: string | null } }) => {
      state.emailSends.push(opts.to);
    },
  ),
}));

vi.mock("~/lib/email-prefs", () => ({
  getUnsubscribedUserIds: vi.fn(async () => new Set<string>()),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

async function load() {
  return await import("../app/app/schedule/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  currentMembershipMock.mockResolvedValue({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  });
});

describe("assignEmployeeAction clash guard (AUDIT.md #6)", () => {
  it("refuses to assign when the worker has approved leave overlapping the shift", async () => {
    state.leaveRows = [
      {
        requestId: "leave-1",
        startDate: "2026-06-04",
        endDate: "2026-06-07",
        leaveTypeName: "Annual leave",
        userId: USER_ID,
      },
    ];
    const { assignEmployeeAction } = await load();
    const result = await assignEmployeeAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, userId: USER_ID }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/Annual leave/);
      expect(result.message).toMatch(/2026-06-04/);
    }
    expect(state.inserts).toHaveLength(0);
    expect(state.emailSends).toHaveLength(0);
  });

  it("assigns when there is no overlapping approved leave", async () => {
    state.leaveRows = []; // no conflicts
    const { assignEmployeeAction } = await load();
    const result = await assignEmployeeAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, userId: USER_ID }),
    );
    expect(result.status).toBe("ok");
    expect(state.inserts).toHaveLength(1);
    expect(state.emailSends).toHaveLength(1);
    expect(state.emailSends[0]).toMatchObject({
      email: "alice@example.com",
      name: "Alice",
    });
  });

  it("refuses when the shift doesn't exist", async () => {
    state.shift = null;
    const { assignEmployeeAction } = await load();
    const result = await assignEmployeeAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, userId: USER_ID }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/Shift not found/);
    }
    expect(state.inserts).toHaveLength(0);
  });

  it("renders a single-day leave window without the date arrow", async () => {
    state.leaveRows = [
      {
        requestId: "leave-2",
        startDate: "2026-06-05",
        endDate: "2026-06-05",
        leaveTypeName: "Personal/Sick leave",
        userId: USER_ID,
      },
    ];
    const { assignEmployeeAction } = await load();
    const result = await assignEmployeeAction(
      { status: "idle" },
      fd({ shiftId: SHIFT_ID, userId: USER_ID }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("Personal/Sick leave on 2026-06-05");
      expect(result.message).not.toContain("→");
    }
  });
});
