import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  shift: null as
    | null
    | {
        id: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        role: string;
        acceptedCount: number;
      },
  /** Approved-leave rows returned by findApprovedLeaveOverlap (AUDIT.md #6). */
  leaveRows: [] as Array<{
    requestId: string;
    startDate: string;
    endDate: string;
    leaveTypeName: string | null;
  }>,
  inserted: [] as Array<Record<string, unknown>>,
  auditCalls: [] as Array<Record<string, unknown>>,
  notifyCalls: [] as Array<{
    tenantId: string;
    input: Record<string, unknown>;
    options?: Record<string, unknown>;
  }>,
  /**
   * Sequence of forTenant().run() invocations. claimShiftAction does:
   *   1. shift lookup (inside its outer run callback)
   *   2. findApprovedLeaveOverlap (a separate run with one select)
   * Track which one we're serving so the harness returns the right rows.
   */
  txSeq: 0,
};

const currentUserMock = vi.fn();
const currentMembershipMock = vi.fn();

function reset() {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow
  state.shift = {
    id: "shift-1",
    status: "published",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000),
    role: "Butcher",
    acceptedCount: 0,
  };
  state.leaveRows = [];
  state.inserted = [];
  state.auditCalls = [];
  state.notifyCalls = [];
  state.txSeq = 0;
}

vi.mock("@tracey/db", () => ({
  scShifts: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    status: { __field: "status" },
    startsAt: { __field: "startsAt" },
    endsAt: { __field: "endsAt" },
    role: { __field: "role" },
  },
  scShiftAssignments: {
    shiftId: { __field: "shiftId" },
    userId: { __field: "userId" },
    status: { __field: "status" },
  },
  scLeaveTypes: { id: { __field: "id" }, name: { __field: "name" } },
  scTimeOffRequests: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    userId: { __field: "userId" },
    startDate: { __field: "startDate" },
    endDate: { __field: "endDate" },
    status: { __field: "status" },
    leaveTypeId: { __field: "leaveTypeId" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const txIndex = state.txSeq;
      state.txSeq += 1;
      const tx = {
        select: () => {
          // tx #0 = shift lookup; tx #1 = leave overlap; later txs (e.g.
          // re-claim attempts) wrap back around but each test resets.
          const rows: unknown[] =
            txIndex === 0
              ? state.shift
                ? [state.shift]
                : []
              : state.leaveRows;
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
          values: (v: Record<string, unknown>) => ({
            onConflictDoNothing: async () => {
              state.inserted.push(v);
              return [];
            },
          }),
        }),
      };
      return fn(tx);
    },
  }),
}));

vi.mock("~/lib/auth/current", () => ({
  currentUser: () => currentUserMock(),
  currentMembership: () => currentMembershipMock(),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
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

async function load() {
  return await import("../app/app/open-shifts/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
  currentUserMock.mockResolvedValue({
    id: "user-lena",
    email: "lena@example.com",
    name: "Lena",
    image: null,
  });
  currentMembershipMock.mockResolvedValue({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "member",
  });
});

describe("claimShiftAction", () => {
  it("inserts an accepted assignment for the caller", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      shiftId: "shift-1",
      userId: "user-lena",
      status: "accepted",
    });
    expect(state.auditCalls[0]?.action).toBe("shiftcraft.shift.claimed");
    expect(state.notifyCalls).toHaveLength(1);
  });

  it("refuses to claim a draft shift", async () => {
    state.shift!.status = "draft";
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("refuses to claim a shift that's already started", async () => {
    state.shift!.startsAt = new Date(Date.now() - 60_000);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses when someone else already accepted", async () => {
    state.shift!.acceptedCount = 1;
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("ignores a missing shift id", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("ignores an unauthenticated caller", async () => {
    currentUserMock.mockResolvedValueOnce(null);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("ignores when there's no active workspace", async () => {
    currentMembershipMock.mockResolvedValueOnce(null);
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses to claim when the caller has approved leave overlapping the shift (AUDIT.md #6)", async () => {
    const dayIso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    state.leaveRows = [
      {
        requestId: "leave-1",
        startDate: dayIso(state.shift!.startsAt),
        endDate: dayIso(state.shift!.endsAt),
        leaveTypeName: "Annual leave",
      },
    ];
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.inserted).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it("notifies admins with the role + start time", async () => {
    const { claimShiftAction } = await load();
    await claimShiftAction(fd({ shiftId: "shift-1" }));
    expect(state.notifyCalls[0]?.input).toMatchObject({
      kind: "shiftcraft_shift_claimed",
      actionUrl: "/app/schedule",
    });
    expect(String(state.notifyCalls[0]?.input.body)).toContain("Butcher");
  });
});
