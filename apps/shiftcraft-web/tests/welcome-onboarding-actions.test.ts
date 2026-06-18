import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

process.env.TRACEY_PII_ENC_KEY = randomBytes(32).toString("base64");

type Emp = {
  id: string;
  traceyTenantId: string;
  email: string | null;
  fullName: string;
  completedAt: Date | null;
  [k: string]: unknown;
};

const state = {
  emp: null as Emp | null,
  tasks: [] as Array<{ id: string }>,
  templates: [] as Array<unknown>,
  updates: [] as Array<Record<string, unknown>>, // scEmployees update patches
  inserts: [] as Array<{ table: string; values: unknown }>,
  audits: [] as Array<{ action: string; targetId?: string | null; details?: unknown }>,
  emails: [] as Array<{ email: string; name: string | null }>,
};

const authState = { role: "admin" as string, userId: "user-1" as string | null };

function reset() {
  state.emp = null;
  state.tasks = [];
  state.templates = [];
  state.updates = [];
  state.inserts = [];
  state.audits = [];
  state.emails = [];
  authState.role = "admin";
  authState.userId = "user-1";
}

function project(row: Record<string, unknown>, proj?: Record<string, unknown>) {
  if (!proj) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(proj)) out[k] = row[k] ?? null;
  return out;
}

vi.mock("@tracey/db", () => {
  const tbl = (name: string) =>
    new Proxy({ __table: name }, { get: (t, p) => (p === "__table" ? name : { __field: String(p) }) });
  return {
    scEmployees: tbl("scEmployees"),
    scDocuments: tbl("scDocuments"),
    scEmployeeOnboardingTasks: tbl("scEmployeeOnboardingTasks"),
    scEmployeePins: tbl("scEmployeePins"),
    scOnboardingTaskTemplates: tbl("scOnboardingTaskTemplates"),
    forTenant: (_tenantId: string) => ({
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const select = (proj?: Record<string, unknown>) => ({
          from: (table: { __table: string }) => {
            const run = async () => {
              if (table.__table === "scEmployees") {
                return state.emp ? [project(state.emp, proj)] : [];
              }
              if (table.__table === "scEmployeeOnboardingTasks") {
                return state.tasks;
              }
              if (table.__table === "scOnboardingTaskTemplates") {
                return state.templates;
              }
              return [];
            };
            const b: Record<string, unknown> = {
              where: () => b,
              orderBy: () => run(),
              limit: () => run(),
            };
            return b;
          },
        });
        const tx = {
          select,
          insert: (table: { __table: string }) => ({
            values: async (values: unknown) => {
              state.inserts.push({ table: table.__table, values });
              return [];
            },
          }),
          update: (table: { __table: string }) => ({
            set: (patch: Record<string, unknown>) => ({
              where: async () => {
                if (table.__table === "scEmployees") {
                  state.updates.push(patch);
                  if (state.emp) Object.assign(state.emp, patch);
                }
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
  currentMembership: vi.fn(async () => ({
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: authState.role,
  })),
  currentUser: vi.fn(async () =>
    authState.userId
      ? { id: authState.userId, email: "admin@example.com", name: "Admin", image: null }
      : null,
  ),
  requireUser: vi.fn(async () => ({
    id: authState.userId ?? "user-1",
    email: "admin@example.com",
    name: "Admin",
  })),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: { action: string; targetId?: string | null; details?: unknown }) => {
    state.audits.push(input);
  }),
}));

vi.mock("~/lib/email", () => ({
  notifyOnboardingInvite: vi.fn(async (opts: { to: { email: string; name: string | null } }) => {
    state.emails.push(opts.to);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

function seedEmp(overrides: Partial<Emp> = {}) {
  state.emp = {
    id: "emp-1",
    traceyTenantId: "tenant-A",
    email: "jane@example.com",
    fullName: "Jane Doe",
    completedAt: null,
    ...overrides,
  };
}

async function welcome() {
  return await import("../app/app/welcome/actions");
}
async function hub() {
  return await import("../app/app/people/onboarding/_actions");
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("selfUpdatePersonalAction", () => {
  it("rejects an emergency-contact relationship that is a phone number", async () => {
    seedEmp();
    const { selfUpdatePersonalAction } = await welcome();
    const res = await selfUpdatePersonalAction(
      { status: "idle" },
      fd({ emergencyContactRelationship: "0400111222" }),
    );
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.fieldErrors?.emergencyContactRelationship).toBeTruthy();
    }
    expect(state.updates.length).toBe(0);
  });

  it("persists a valid relationship", async () => {
    seedEmp();
    const { selfUpdatePersonalAction } = await welcome();
    const res = await selfUpdatePersonalAction(
      { status: "idle" },
      fd({ emergencyContactRelationship: "Spouse" }),
    );
    expect(res.status).toBe("ok");
    expect(state.updates[0]?.emergencyContactRelationship).toBe("Spouse");
  });
});

describe("selfSavePayrollPiiAction", () => {
  it("builds the TFN-declaration and work-eligibility jsonb when answered", async () => {
    seedEmp();
    const { selfSavePayrollPiiAction } = await welcome();
    const res = await selfSavePayrollPiiAction(
      { status: "idle" },
      fd({
        bankAccountName: "Jane Doe",
        residency: "resident",
        payBasis: "casual",
        claimTaxFreeThreshold: "on",
        hasStudyLoan: "",
        workVisa: "citizen_or_pr",
        superEligible: "on",
      }),
    );
    expect(res.status).toBe("ok");
    const patch = state.updates[0]!;
    expect(patch.bankAccountName).toBe("Jane Doe");
    expect(patch.tfnDeclaration).toMatchObject({
      residency: "resident",
      payBasis: "casual",
      claimTaxFreeThreshold: true,
      hasStudyLoan: false,
    });
    expect(patch.workEligibility).toEqual({
      workVisa: "citizen_or_pr",
      superEligible: true,
    });
  });

  it("leaves the jsonb blocks untouched when nothing is answered", async () => {
    seedEmp();
    const { selfSavePayrollPiiAction } = await welcome();
    await selfSavePayrollPiiAction(
      { status: "idle" },
      fd({ bsb: "062-000" }),
    );
    const patch = state.updates[0]!;
    expect("tfnDeclaration" in patch).toBe(false);
    expect("workEligibility" in patch).toBe(false);
  });
});

const EMP_UUID = "11111111-1111-4111-8111-111111111111";

describe("sendOnboardingEmailAction", () => {
  it("emails the employee and redirects with sent=1", async () => {
    seedEmp({ id: EMP_UUID, email: "jane@example.com", completedAt: null });
    const { sendOnboardingEmailAction } = await hub();
    await expect(
      sendOnboardingEmailAction(fd({ employeeId: EMP_UUID })),
    ).rejects.toThrow("NEXT_REDIRECT: /app/people/onboarding?sent=1");
    expect(state.emails).toEqual([{ email: "jane@example.com", name: "Jane Doe" }]);
    expect(
      state.audits.some((a) => a.action === "shiftcraft.onboarding.email_sent"),
    ).toBe(true);
    // Not-yet-completed → pushed into the queue.
    expect(state.updates.some((u) => u.onboardingStatus === "pending")).toBe(true);
  });

  it("bounces with sent=noemail when the employee has no email", async () => {
    seedEmp({ id: EMP_UUID, email: null });
    const { sendOnboardingEmailAction } = await hub();
    await expect(
      sendOnboardingEmailAction(fd({ employeeId: EMP_UUID })),
    ).rejects.toThrow("NEXT_REDIRECT: /app/people/onboarding?sent=noemail");
    expect(state.emails.length).toBe(0);
  });

  it("forbids non-managers", async () => {
    authState.role = "member";
    seedEmp({ id: EMP_UUID });
    const { sendOnboardingEmailAction } = await hub();
    await expect(
      sendOnboardingEmailAction(fd({ employeeId: EMP_UUID })),
    ).rejects.toThrow("Forbidden");
    expect(state.emails.length).toBe(0);
  });
});
