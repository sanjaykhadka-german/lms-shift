import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Real encryption (not mocked) so the test asserts the round-trip against the
// actual @tracey/db/pii helper — same posture as payroll-pii-actions.test.ts.
process.env.TRACEY_PII_ENC_KEY = randomBytes(32).toString("base64");

type Row = {
  id: string;
  traceyTenantId: string;
  appUserId: string | null;
  [k: string]: unknown;
};

const state = {
  rows: new Map<string, Row>(),
  audits: [] as Array<{
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
  lastTenantIdForTenant: undefined as string | undefined,
};

// Mutable auth context so individual tests can flip role / identity.
const authState = {
  role: "admin" as string,
  userId: "user-1" as string | null,
};

function resetState() {
  state.rows.clear();
  state.audits = [];
  state.lastTenantIdForTenant = undefined;
  authState.role = "admin";
  authState.userId = "user-1";
}

function seedRow(id: string, tenantId: string, overrides: Partial<Row> = {}) {
  state.rows.set(id, {
    id,
    traceyTenantId: tenantId,
    appUserId: null,
    ...overrides,
  });
}

vi.mock("@tracey/db", () => {
  const scEmployees = {
    __table: "scEmployees",
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    appUserId: { __field: "appUserId" },
  };
  return {
    scEmployees,
    scDocuments: { __table: "scDocuments", fileSize: { __field: "fileSize" } },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        state.lastTenantIdForTenant = tenantId;
        const tx = {
          select: (proj?: Record<string, unknown>) => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  const matches = Array.from(state.rows.values()).filter(
                    (r) => r.traceyTenantId === tenantId,
                  );
                  if (matches.length === 0) return [];
                  const row = matches[0]!;
                  if (proj) {
                    const out: Record<string, unknown> = {};
                    for (const k of Object.keys(proj)) {
                      out[k] = (row as Record<string, unknown>)[k] ?? null;
                    }
                    return [out];
                  }
                  return [row];
                },
              }),
            }),
          }),
          update: () => ({
            set: (patch: Record<string, unknown>) => ({
              where: async () => {
                const row = Array.from(state.rows.values())[0];
                if (row) Object.assign(row, patch);
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
      ? { id: authState.userId, email: "u@example.com", name: "U", image: null }
      : null,
  ),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(
    async (input: {
      action: string;
      targetId?: string | null;
      details?: Record<string, unknown> | null;
    }) => {
      state.audits.push(input);
    },
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function load() {
  return await import(
    "../app/app/people/onboarding/_employee-onboarding-actions"
  );
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

// A fully-valid submission; spread + override per test.
function validForm(): Record<string, string> {
  return {
    fullName: "Jane Doe",
    preferredName: "Jane",
    dateOfBirth: "1990-05-01",
    gender: "female",
    email: "jane@example.com",
    mobile: "+61 400 000 000",
    addressLine: "1 Test St, Sydney NSW 2000",
    emergencyContactName: "John Doe",
    emergencyContactPhone: "+61 400 111 222",
    emergencyContactRelationship: "Spouse",
    bankAccountName: "Jane Doe",
    bsb: "062-000",
    accountNumber: "12345678",
    hasTfn: "yes",
    tfn: "123 456 789",
    residency: "resident",
    payBasis: "casual",
    claimTaxFreeThreshold: "yes",
    hasStudyLoan: "no",
    declarationTrue: "on",
    superEligible: "yes",
    superChoice: "own",
    superFundName: "AustralianSuper",
    superMemberNumber: "AS123456",
    workVisa: "citizen_or_pr",
  };
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
});

describe("submitEmployeeOnboardingAction", () => {
  it("persists every section incl. the 4 new fields, encrypts PII, and audits field names only", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd(validForm()),
    );

    expect(result.status).toBe("ok");
    const row = state.rows.get("emp-1")!;

    // Plain columns.
    expect(row.fullName).toBe("Jane Doe");
    expect(row.preferredName).toBe("Jane");
    expect(row.dateOfBirth).toBe("1990-05-01");
    expect(row.emergencyContactName).toBe("John Doe");
    expect(row.onboardingStatus).toBe("active");

    // The 4 new fields.
    expect(row.emergencyContactRelationship).toBe("Spouse");
    expect(row.bankAccountName).toBe("Jane Doe");
    expect(row.tfnDeclaration).toMatchObject({
      residency: "resident",
      payBasis: "casual",
      claimTaxFreeThreshold: true,
      hasStudyLoan: false,
    });
    expect(typeof (row.tfnDeclaration as { declaredTrueAt: string }).declaredTrueAt).toBe("string");
    expect(row.workEligibility).toEqual({
      workVisa: "citizen_or_pr",
      superEligible: true,
    });

    // PII encrypted (v1: tokens), plaintext never present in the column.
    expect(row.tfnEnc).toMatch(/^v1:/);
    expect(row.tfnEnc).not.toContain("123456789");
    expect(row.bsbEnc).toMatch(/^v1:/);
    expect(row.bsbEnc).not.toContain("062000");
    expect(row.accountNumberEnc).toMatch(/^v1:/);
    expect(row.accountNumberEnc).not.toContain("12345678");
    expect(row.superMemberNumberEnc).toMatch(/^v1:/);
    // Fund name is intentionally plaintext — not PII.
    expect(row.superFundName).toBe("AustralianSuper");

    // Audit names fields only; never the plaintext TFN.
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.employee.onboarding_submitted",
    );
    expect(audit).toBeDefined();
    expect(audit!.targetId).toBe("emp-1");
    expect(JSON.stringify(audit)).not.toContain("123456789");
  });

  it("stores no TFN when the employee selects 'I don't have one'", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd({ ...validForm(), hasTfn: "no", tfn: "" }),
    );

    expect(result.status).toBe("ok");
    expect(state.rows.get("emp-1")!.tfnEnc).toBeNull();
  });

  it("requires mobile, DOB, address and emergency contact", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd({
        ...validForm(),
        mobile: "",
        dateOfBirth: "",
        addressLine: "",
        emergencyContactName: "",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.mobile).toBeTruthy();
      expect(result.fieldErrors?.dateOfBirth).toBeTruthy();
      expect(result.fieldErrors?.addressLine).toBeTruthy();
      expect(result.fieldErrors?.emergencyContactName).toBeTruthy();
    }
    // Nothing written, nothing audited.
    expect(state.rows.get("emp-1")!.fullName).toBeUndefined();
    expect(state.audits.length).toBe(0);
  });

  it("rejects an emergency-contact relationship that is a phone number", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd({ ...validForm(), emergencyContactRelationship: "0400111222" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.emergencyContactRelationship).toBeTruthy();
    }
  });

  it("requires a TFN unless the employee opted out", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd({ ...validForm(), hasTfn: "yes", tfn: "" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.tfn).toBeTruthy();
    }
  });

  it("requires fund name + member number when choosing an own super fund", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd({ ...validForm(), superChoice: "own", superFundName: "", superMemberNumber: "" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.superFundName).toBeTruthy();
      expect(result.fieldErrors?.superMemberNumber).toBeTruthy();
    }
  });

  it("scopes the write to the caller's tenant via forTenant()", async () => {
    seedRow("emp-1", "tenant-A");
    const { submitEmployeeOnboardingAction } = await load();

    await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd(validForm()),
    );

    expect(state.lastTenantIdForTenant).toBe("tenant-A");
  });

  it("rejects a non-self, non-manager submitter", async () => {
    // Member role, and the row belongs to someone else → not self, not manager.
    authState.role = "member";
    authState.userId = "user-1";
    seedRow("emp-1", "tenant-A", { appUserId: "someone-else" });
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd(validForm()),
    );

    expect(result.status).toBe("error");
    // No write, no audit.
    expect(state.rows.get("emp-1")!.fullName).toBeUndefined();
    expect(
      state.audits.some(
        (a) => a.action === "shiftcraft.employee.onboarding_submitted",
      ),
    ).toBe(false);
  });

  it("allows the employee to complete their own onboarding even as a plain member", async () => {
    authState.role = "member";
    authState.userId = "user-self";
    seedRow("emp-1", "tenant-A", { appUserId: "user-self" });
    const { submitEmployeeOnboardingAction } = await load();

    const result = await submitEmployeeOnboardingAction(
      "emp-1",
      { status: "idle" },
      fd(validForm()),
    );

    expect(result.status).toBe("ok");
    expect(state.rows.get("emp-1")!.onboardingStatus).toBe("active");
  });
});
