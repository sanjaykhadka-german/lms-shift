import { describe, it, expect, beforeEach, vi } from "vitest";

// AUDIT.md #6 close-out: when an admin approves a time-off request,
// any overlapping accepted/offered shift assignments must flip to
// `declined` in the same step, with audit + worker notification.

interface CapturedUpdate {
  table: "scTimeOffRequests" | "scShiftAssignments";
  patch: Record<string, unknown>;
}

const state = {
  updates: [] as CapturedUpdate[],
  selects: 0,
  audits: [] as Array<{ action: string; details?: Record<string, unknown> | null }>,
  notifications: [] as Array<{
    recipientUserId: string;
    kind: string;
    title: string;
  }>,
  request: {
    id: "req-1",
    userId: "user-bob",
    startDate: "2026-06-03",
    endDate: "2026-06-07",
    leaveTypeId: "lt-annual",
  } as null | {
    id: string;
    userId: string;
    startDate: string;
    endDate: string;
    leaveTypeId: string;
  },
  affected: [] as Array<{
    shiftId: string;
    startsAt: Date;
    endsAt: Date;
    role: string;
    locationName: string | null;
    status: "accepted" | "offered";
  }>,
  leaveTypeName: "Annual" as string | null,
};

function reset() {
  state.updates = [];
  state.selects = 0;
  state.audits = [];
  state.notifications = [];
  state.request = {
    id: "req-1",
    userId: "user-bob",
    startDate: "2026-06-03",
    endDate: "2026-06-07",
    leaveTypeId: "lt-annual",
  };
  state.affected = [];
  state.leaveTypeName = "Annual";
}

vi.mock("@tracey/db", () => {
  // Carriers for the table identity in update().where → so the test can
  // tell which table is being patched.
  const scTimeOffRequests = { __table: "scTimeOffRequests" as const };
  const scShiftAssignments = { __table: "scShiftAssignments" as const };
  const scLeaveTypes = { __table: "scLeaveTypes" as const };
  return {
    scTimeOffRequests,
    scShiftAssignments,
    scLeaveTypes,
    forTenant: (_tid: string) => ({
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: () => ({
            from: (tbl: { __table: string }) => ({
              where: () => ({
                async limit() {
                  state.selects += 1;
                  if (tbl.__table === "scTimeOffRequests") {
                    return state.request ? [state.request] : [];
                  }
                  if (tbl.__table === "scLeaveTypes") {
                    return state.leaveTypeName
                      ? [{ name: state.leaveTypeName }]
                      : [];
                  }
                  return [];
                },
              }),
            }),
          }),
          update: (tbl: { __table: CapturedUpdate["table"] }) => ({
            set: (patch: Record<string, unknown>) => ({
              where: async () => {
                state.updates.push({ table: tbl.__table, patch });
                return [{ id: "row" }];
              },
            }),
          }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/time-off-impact", () => ({
  findAffectedShifts: vi.fn(async () => state.affected),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: { action: string; details?: Record<string, unknown> | null }) => {
    state.audits.push({ action: input.action, details: input.details });
  }),
}));

vi.mock("~/lib/notifications", () => ({
  createNotifications: vi.fn(
    async (
      _tid: string,
      inputs: Array<{ recipientUserId: string; kind: string; title: string }>,
    ) => {
      for (const i of inputs) state.notifications.push(i);
    },
  ),
}));

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => ({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  })),
  requireUser: vi.fn(async () => ({
    id: "user-admin",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import("../app/app/time-off/actions");
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("approveTimeOffAction", () => {
  it("flips the request to approved when no shifts overlap", async () => {
    state.affected = [];
    const { approveTimeOffAction } = await load();
    await approveTimeOffAction(fd({ id: "req-1" }));

    const requestUpdates = state.updates.filter(
      (u) => u.table === "scTimeOffRequests",
    );
    const assignmentUpdates = state.updates.filter(
      (u) => u.table === "scShiftAssignments",
    );
    expect(requestUpdates).toHaveLength(1);
    expect(requestUpdates[0]!.patch.status).toBe("approved");
    expect(assignmentUpdates).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);

    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.time_off.approved",
    );
    expect(audit).toBeDefined();
    expect(audit?.details?.autoDeclinedShifts).toBe(0);
  });

  it("auto-declines accepted + offered assignments and notifies the worker", async () => {
    state.affected = [
      {
        shiftId: "shift-1",
        startsAt: new Date("2026-06-04T09:00:00Z"),
        endsAt: new Date("2026-06-04T17:00:00Z"),
        role: "Front of house",
        locationName: "Main",
        status: "accepted",
      },
      {
        shiftId: "shift-2",
        startsAt: new Date("2026-06-05T09:00:00Z"),
        endsAt: new Date("2026-06-05T17:00:00Z"),
        role: "Counter",
        locationName: null,
        status: "offered",
      },
    ];
    const { approveTimeOffAction } = await load();
    await approveTimeOffAction(fd({ id: "req-1" }));

    const requestUpdates = state.updates.filter(
      (u) => u.table === "scTimeOffRequests",
    );
    const assignmentUpdates = state.updates.filter(
      (u) => u.table === "scShiftAssignments",
    );
    expect(requestUpdates).toHaveLength(1);
    expect(assignmentUpdates).toHaveLength(1);
    expect(assignmentUpdates[0]!.patch.status).toBe("declined");
    // respondedAt should be stamped (Date instance, any value).
    expect(assignmentUpdates[0]!.patch.respondedAt).toBeInstanceOf(Date);

    expect(state.notifications).toHaveLength(2);
    for (const n of state.notifications) {
      expect(n.recipientUserId).toBe("user-bob");
      expect(n.kind).toBe("shiftcraft.shift.unassigned_leave");
      expect(n.title).toMatch(/leave approved/i);
    }

    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.time_off.approved",
    );
    expect(audit?.details?.autoDeclinedShifts).toBe(2);
    expect(audit?.details?.leaveTypeName).toBe("Annual");
  });

  it("no-ops cleanly when the request id doesn't resolve in this tenant", async () => {
    state.request = null;
    state.affected = [
      {
        shiftId: "shift-x",
        startsAt: new Date("2026-06-04T09:00:00Z"),
        endsAt: new Date("2026-06-04T17:00:00Z"),
        role: "Counter",
        locationName: null,
        status: "accepted",
      },
    ];
    const { approveTimeOffAction } = await load();
    await approveTimeOffAction(fd({ id: "req-1" }));

    expect(state.updates).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("returns silently when the form is missing an id", async () => {
    const { approveTimeOffAction } = await load();
    await approveTimeOffAction(fd({}));
    expect(state.updates).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});
