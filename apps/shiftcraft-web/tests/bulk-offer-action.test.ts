import { describe, it, expect, beforeEach, vi } from "vitest";

interface Candidate {
  appUserId: string;
  departmentId: string | null;
}

const SHIFT_ID = "11111111-1111-1111-1111-111111111111";

const state = {
  shift: null as
    | null
    | {
        id: string;
        startsAt: Date;
        endsAt: Date;
        role: string;
        locationName: string | null;
      },
  candidates: [] as Candidate[],
  /** ids of users who already have ANY assignment row on this shift */
  preAssigned: new Set<string>(),
  /** ids of users with approved leave overlapping the shift window */
  leaveConflicts: new Set<string>(),
  inserts: [] as Array<{ shiftId: string; userId: string }>,
  emailSends: [] as Array<{ email: string; name: string | null }>,
  unsubscribed: new Set<string>(),
  recipientDir: new Map<
    string,
    { id: string; email: string; name: string | null }
  >(),
  auditCalls: [] as Record<string, unknown>[],
  selectIdx: 0,
};

const currentMembershipMock = vi.fn();

function reset() {
  state.shift = {
    id: SHIFT_ID,
    startsAt: new Date("2026-05-20T08:00:00Z"),
    endsAt: new Date("2026-05-20T16:00:00Z"),
    role: "Butcher",
    locationName: "Brunswick Store",
  };
  state.candidates = [];
  state.preAssigned = new Set();
  state.leaveConflicts = new Set();
  state.inserts = [];
  state.emailSends = [];
  state.unsubscribed = new Set();
  state.recipientDir = new Map();
  state.auditCalls = [];
  state.selectIdx = 0;
}

// Tracks which forTenant().run() select is being served — bulkOffer
// makes four sequential select calls inside forTenant: (1) shift, (2)
// candidates, (3) leaveConflicts (AUDIT.md #6), (4) re-derive
// newly-offered. The fifth+ are inside the per-row insert loop (we
// don't intercept those here).
const TENANT_SELECTS = [
  "shift",
  "candidates",
  "leaveConflicts",
  "newly",
] as const;

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
    scEmployees: cols([
      "id",
      "traceyTenantId",
      "appUserId",
      "departmentId",
    ]),
    scDepartments: cols(["id", "name"]),
    scShiftAssignments: cols([
      "id",
      "shiftId",
      "userId",
      "status",
    ]),
    scLeaveTypes: cols(["id", "traceyTenantId", "name", "slug"]),
    scTimeOffRequests: cols([
      "id",
      "traceyTenantId",
      "userId",
      "leaveTypeId",
      "startDate",
      "endDate",
      "status",
    ]),
    users: cols(["id", "name", "email"]),
    members: cols(["id"]),
    db: {
      select: () => ({
        from: () => ({
          where: async () =>
            // Recipients for the email send — pulled from the directory.
            Array.from(state.recipientDir.values()),
        }),
      }),
    },
    forTenant: (tid: string) => ({
      tenantId: tid,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: () => {
            const which =
              TENANT_SELECTS[state.selectIdx] ?? "unknown";
            state.selectIdx += 1;
            // Resolve to the right rows for whichever sequential
            // select this is.
            const resolveRows = (): unknown[] => {
              if (which === "shift") return state.shift ? [state.shift] : [];
              if (which === "candidates") return state.candidates;
              if (which === "leaveConflicts")
                return Array.from(state.leaveConflicts).map((uid) => ({
                  userId: uid,
                }));
              if (which === "newly")
                return state.inserts.map((i) => ({ userId: i.userId }));
              return [];
            };
            // The chain has to support BOTH `.where(...).limit(1)` (for
            // the shift lookup) AND `await tx.select().from().leftJoin().where()`
            // (for the candidates lookup with no limit). Return a
            // thenable that ALSO carries `.limit()`.
            const whereChain = {
              limit: async (_n: number) => resolveRows(),
              then(
                onF: (v: unknown[]) => unknown,
                onR?: (e: unknown) => unknown,
              ) {
                return Promise.resolve(resolveRows()).then(onF, onR);
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
            values: (v: { shiftId: string; userId: string }) => ({
              onConflictDoNothing: () => ({
                returning: async () => {
                  if (state.preAssigned.has(v.userId)) return [];
                  state.inserts.push(v);
                  state.preAssigned.add(v.userId);
                  return [{ id: `new-${state.inserts.length}` }];
                },
              }),
            }),
          }),
        };
        return fn(tx);
      },
    }),
  };
});

// Pin the notification channel to email-only: the offer path keeps its
// existing email behaviour and skips the in-app/getNotifyChannel DB read
// (which would otherwise consume an extra ordered forTenant select here).
vi.mock("~/lib/notify-prefs", () => ({
  getNotifyChannel: async () => "email",
  wantsEmail: () => true,
  wantsInApp: () => false,
}));

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
  logAuditEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.auditCalls.push(input);
  }),
}));

vi.mock("~/lib/email", () => ({
  notifyShiftOffered: vi.fn(
    async (opts: { to: { email: string; name: string | null } }) => {
      state.emailSends.push(opts.to);
    },
  ),
}));

vi.mock("~/lib/email-prefs", () => ({
  getUnsubscribedUserIds: vi.fn(async () => state.unsubscribed),
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

function addCandidate(
  appUserId: string,
  email: string,
  name: string | null,
  departmentId: string | null = null,
) {
  state.candidates.push({ appUserId, departmentId });
  state.recipientDir.set(appUserId, { id: appUserId, email, name });
}

describe("bulkOfferShiftAction", () => {
  it("inserts an offered row for each candidate + emails them + audits", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    addCandidate("u-tomas", "tomas@example.com", "Tomas");
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts).toHaveLength(2);
    expect(state.emailSends.map((r) => r.email).sort()).toEqual([
      "lena@example.com",
      "tomas@example.com",
    ]);
    expect(state.auditCalls[0]).toMatchObject({
      action: "shiftcraft.shift.bulk_offered",
      targetId: SHIFT_ID,
      details: {
        candidates: 2,
        offered: 2,
        skipped: 0,
      },
    });
  });

  it("skips candidates who already have an assignment", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    addCandidate("u-tomas", "tomas@example.com", "Tomas");
    state.preAssigned = new Set(["u-lena"]);
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts.map((i) => i.userId)).toEqual(["u-tomas"]);
    expect(state.auditCalls[0]?.details).toMatchObject({
      offered: 1,
      skipped: 1,
    });
  });

  it("respects email opt-outs (still inserts but doesn't email)", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    addCandidate("u-tomas", "tomas@example.com", "Tomas");
    state.unsubscribed = new Set(["u-tomas"]);
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts).toHaveLength(2);
    expect(state.emailSends.map((r) => r.email)).toEqual([
      "lena@example.com",
    ]);
  });

  it("refuses non-admins", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    currentMembershipMock.mockResolvedValueOnce({
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    });
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/admin/i);
    expect(state.inserts).toHaveLength(0);
  });

  it("no-ops cleanly when there are no candidates (audit + redirect)", async () => {
    // No candidates added.
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts).toHaveLength(0);
    expect(state.auditCalls[0]?.details).toMatchObject({
      candidates: 0,
      offered: 0,
      skipped: 0,
    });
  });

  it("refuses when the shift doesn't exist in this tenant", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    state.shift = null;
    const { bulkOfferShiftAction } = await load();
    await bulkOfferShiftAction(
      fd({ shiftId: SHIFT_ID, departmentId: "" }),
    );
    expect(state.inserts).toHaveLength(0);
    expect(state.auditCalls).toHaveLength(0);
  });

  it("skips candidates with approved leave overlapping the shift (AUDIT.md #6)", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    addCandidate("u-tomas", "tomas@example.com", "Tomas");
    state.leaveConflicts = new Set(["u-tomas"]);
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(state.inserts.map((i) => i.userId)).toEqual(["u-lena"]);
    expect(state.auditCalls[0]?.details).toMatchObject({
      offered: 1,
      skippedDueToLeave: 1,
      candidates: 2,
    });
  });

  it("no-ops when every candidate is on approved leave (AUDIT.md #6)", async () => {
    addCandidate("u-lena", "lena@example.com", "Lena");
    addCandidate("u-tomas", "tomas@example.com", "Tomas");
    state.leaveConflicts = new Set(["u-lena", "u-tomas"]);
    const { bulkOfferShiftAction } = await load();
    await expect(
      bulkOfferShiftAction(fd({ shiftId: SHIFT_ID, departmentId: "" })),
    ).rejects.toThrow(/leave=2/);
    expect(state.inserts).toHaveLength(0);
    expect(state.auditCalls[0]?.details).toMatchObject({
      offered: 0,
      skippedDueToLeave: 2,
      candidates: 2,
    });
  });
});
