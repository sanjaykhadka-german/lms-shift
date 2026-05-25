import { describe, it, expect, beforeEach, vi } from "vitest";

const state = {
  inserts: [] as Array<{ values: Record<string, unknown>; conflictPatch?: Record<string, unknown> }>,
  deletes: 0,
  lastTenantId: undefined as string | undefined,
  // AUDIT.md #4 — the new clearTimesheetApprovalAction reads the
  // previous status before deciding which audit event to emit + whether
  // to require a reason. Tests set this to drive that branch.
  existingStatus: null as "approved" | "disputed" | null,
  audits: [] as Array<{
    action: string;
    targetKind?: string | null;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.inserts = [];
  state.deletes = 0;
  state.lastTenantId = undefined;
  state.existingStatus = null;
  state.audits = [];
}

vi.mock("@tracey/db", () => ({
  scTimesheetApprovals: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    employeeUserId: { __field: "employeeUserId" },
    weekStart: { __field: "weekStart" },
    status: { __field: "status" },
  },
  forTenant: (tid: string) => ({
    tenantId: tid,
    async run(fn: (tx: unknown) => Promise<unknown>) {
      state.lastTenantId = tid;
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              async limit() {
                return state.existingStatus
                  ? [{ status: state.existingStatus }]
                  : [];
              },
            }),
          }),
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            onConflictDoUpdate: async ({
              set,
            }: {
              target: unknown;
              set: Record<string, unknown>;
            }) => {
              state.inserts.push({ values: v, conflictPatch: set });
              return [{ id: "new-id" }];
            },
            async then() {
              state.inserts.push({ values: v });
            },
          }),
        }),
        delete: () => ({
          where: async () => {
            state.deletes += 1;
            return [{ id: "deleted" }];
          },
        }),
      };
      return fn(tx);
    },
  }),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input) => {
    state.audits.push(input);
  }),
}));

vi.mock("~/lib/auth/current", () => ({
  currentMembership: () => currentMembershipMock(),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
}));

vi.mock("~/lib/webhooks", () => ({
  emitWebhook: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import("../app/app/timesheets/actions");
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

describe("approveTimesheetAction", () => {
  it("upserts an approved row for the given (user, week)", async () => {
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values).toMatchObject({
      traceyTenantId: "tenant-A",
      employeeUserId: "emp-1",
      weekStart: "2026-05-11",
      status: "approved",
      approvedByUserId: "user-1",
    });
    // onConflictDoUpdate set-patch also marks approved.
    expect(state.inserts[0]!.conflictPatch?.status).toBe("approved");
  });

  it("snaps a mid-week date to that week's Monday", async () => {
    const { approveTimesheetAction } = await load();
    // 2026-05-14 is a Thursday. Monday of that week is 2026-05-11.
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-14" }),
    );
    expect(state.inserts[0]!.values.weekStart).toBe("2026-05-11");
  });

  it("refuses non-managers without writing anything", async () => {
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.inserts).toHaveLength(0);
    expect(state.deletes).toBe(0);
  });

  it("ignores missing employee id", async () => {
    const { approveTimesheetAction } = await load();
    await approveTimesheetAction(fd({ weekStart: "2026-05-11" }));
    expect(state.inserts).toHaveLength(0);
  });
});

describe("disputeTimesheetAction", () => {
  it("writes a disputed row with notes", async () => {
    const { disputeTimesheetAction } = await load();
    await disputeTimesheetAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        notes: "Please re-check Tuesday.",
      }),
    );
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]!.values).toMatchObject({
      status: "disputed",
      notes: "Please re-check Tuesday.",
    });
  });

  it("stores null notes when blank", async () => {
    const { disputeTimesheetAction } = await load();
    await disputeTimesheetAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        notes: "   ",
      }),
    );
    expect(state.inserts[0]!.values.notes).toBeNull();
  });
});

describe("clearTimesheetApprovalAction", () => {
  it("deletes a disputed row without requiring a reason + audits dispute_cleared", async () => {
    state.existingStatus = "disputed";
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.deletes).toBe(1);
    expect(state.lastTenantId).toBe("tenant-A");
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.timesheet.dispute_cleared",
    );
    expect(audit).toBeDefined();
    expect(audit!.details).toMatchObject({
      previousStatus: "disputed",
      reason: null,
    });
  });

  it("deletes when no existing row + audits dispute_cleared with previousStatus null", async () => {
    // state.existingStatus stays null — simulates Reset being clicked
    // on a row that has no approval row at all (defensive UI path).
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.deletes).toBe(1);
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.timesheet.dispute_cleared",
    );
    expect(audit!.details).toMatchObject({ previousStatus: null });
  });

  it("REOPENS an approved row when a reason is supplied + audits reopened with reason", async () => {
    state.existingStatus = "approved";
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        reason: "Missed lunch break needs adjusting",
      }),
    );
    expect(state.deletes).toBe(1);
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.timesheet.reopened",
    );
    expect(audit).toBeDefined();
    expect(audit!.details).toMatchObject({
      employeeUserId: "emp-1",
      weekStart: "2026-05-11",
      previousStatus: "approved",
      reason: "Missed lunch break needs adjusting",
    });
  });

  it("REFUSES to reopen an approved row when reason is missing", async () => {
    state.existingStatus = "approved";
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({ employeeUserId: "emp-1", weekStart: "2026-05-11" }),
    );
    expect(state.deletes).toBe(0);
    expect(
      state.audits.some((a) => a.action === "shiftcraft.timesheet.reopened"),
    ).toBe(false);
  });

  it("REFUSES to reopen an approved row when reason is whitespace-only", async () => {
    state.existingStatus = "approved";
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        reason: "   ",
      }),
    );
    expect(state.deletes).toBe(0);
  });

  it("is a no-op for a non-manager regardless of existing status", async () => {
    state.existingStatus = "approved";
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { clearTimesheetApprovalAction } = await load();
    await clearTimesheetApprovalAction(
      fd({
        employeeUserId: "emp-1",
        weekStart: "2026-05-11",
        reason: "reopen please",
      }),
    );
    expect(state.deletes).toBe(0);
    expect(state.audits).toHaveLength(0);
  });
});
