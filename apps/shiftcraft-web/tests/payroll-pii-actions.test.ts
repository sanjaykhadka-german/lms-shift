import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

// We use real encryption (not mocked) so the test asserts the round-trip
// against the actual @tracey/db/pii helper. The action under test calls
// encryptPii on save and decryptPii on reveal; if either side ever drifts,
// these assertions catch it.
process.env.TRACEY_PII_ENC_KEY = randomBytes(32).toString("base64");

const state = {
  rows: new Map<
    string,
    {
      id: string;
      traceyTenantId: string;
      tfnEnc: string | null;
      bsbEnc: string | null;
      accountNumberEnc: string | null;
      superFundName: string | null;
      superMemberNumberEnc: string | null;
    }
  >(),
  audits: [] as Array<{
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
  lastTenantIdForTenant: undefined as string | undefined,
};

function resetState() {
  state.rows.clear();
  state.audits = [];
  state.lastTenantIdForTenant = undefined;
}

function seedRow(
  id: string,
  tenantId: string,
  overrides: Partial<{
    tfnEnc: string | null;
    bsbEnc: string | null;
    accountNumberEnc: string | null;
    superFundName: string | null;
    superMemberNumberEnc: string | null;
  }> = {},
) {
  state.rows.set(id, {
    id,
    traceyTenantId: tenantId,
    tfnEnc: null,
    bsbEnc: null,
    accountNumberEnc: null,
    superFundName: null,
    superMemberNumberEnc: null,
    ...overrides,
  });
}

vi.mock("@tracey/db", () => {
  const scEmployees = {
    __table: "scEmployees",
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    tfnEnc: { __field: "tfnEnc" },
    bsbEnc: { __field: "bsbEnc" },
    accountNumberEnc: { __field: "accountNumberEnc" },
    superFundName: { __field: "superFundName" },
    superMemberNumberEnc: { __field: "superMemberNumberEnc" },
    updatedAt: { __field: "updatedAt" },
  };
  return {
    scEmployees,
    // The action file imports a number of other symbols; the action under
    // test doesn't touch them but the module must still resolve.
    scEmployeePins: { __table: "scEmployeePins" },
    scDepartments: { __table: "scDepartments" },
    auditEvents: { __table: "auditEvents" },
    users: { __table: "users" },
    members: { __table: "members" },
    db: {
      insert: () => ({ values: async () => [] }),
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => [] }),
          }),
          where: () => ({ limit: async () => [] }),
        }),
      }),
      update: () => ({
        set: () => ({ where: async () => [] }),
      }),
    },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        state.lastTenantIdForTenant = tenantId;
        const tx = {
          select: (proj?: Record<string, unknown>) => ({
            from: () => ({
              where: () => ({
                limit: async () => {
                  // Both reveal (full row projection) and save's
                  // tenant-scope check (id-only projection) come through
                  // here. We just return the seeded row scoped to the
                  // current tenant; the mock isn't smart enough to filter
                  // by id, but tests target one row at a time.
                  const matches = Array.from(state.rows.values()).filter(
                    (r) => r.traceyTenantId === tenantId,
                  );
                  if (matches.length === 0) return [];
                  const row = matches[0]!;
                  // Build a projection-aware result so the action sees the
                  // fields it asked for.
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
    role: "admin",
  })),
  currentUser: vi.fn(async () => ({
    id: "user-1",
    email: "admin@example.com",
    name: "Admin",
    image: null,
  })),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input: { action: string; targetId?: string | null; details?: Record<string, unknown> | null }) => {
    state.audits.push(input);
  }),
}));

vi.mock("~/lib/notifications", () => ({
  notifyTenantAdmins: vi.fn(),
}));

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

describe("savePayrollPiiAction", () => {
  it("encrypts each sensitive field, leaves super_fund_name plaintext, and audits the change", async () => {
    seedRow("emp-1", "tenant-A");
    const { savePayrollPiiAction } = await load();

    const result = await savePayrollPiiAction(
      "emp-1",
      { status: "idle" },
      fd({
        tfn: "123 456 789",
        bsb: "062-000",
        accountNumber: "12345678",
        superFundName: "AustralianSuper",
        superMemberNumber: "AS123456",
      }),
    );

    expect(result.status).toBe("ok");
    const row = state.rows.get("emp-1")!;
    // Each ciphertext column holds a v1: token, and none of them contains
    // the plaintext anywhere — the audit/log surface won't accidentally
    // capture sensitive substrings.
    expect(row.tfnEnc).toMatch(/^v1:/);
    expect(row.tfnEnc).not.toContain("123456789");
    expect(row.bsbEnc).toMatch(/^v1:/);
    expect(row.bsbEnc).not.toContain("062000");
    expect(row.accountNumberEnc).toMatch(/^v1:/);
    expect(row.accountNumberEnc).not.toContain("12345678");
    expect(row.superMemberNumberEnc).toMatch(/^v1:/);
    // super_fund_name is intentionally plaintext — fund names are not PII.
    expect(row.superFundName).toBe("AustralianSuper");

    // Audit event names the fields that changed but never the values.
    const saved = state.audits.find(
      (a) => a.action === "shiftcraft.employee.pii_saved",
    );
    expect(saved).toBeDefined();
    expect(saved!.targetId).toBe("emp-1");
    expect(saved!.details).toMatchObject({
      fields: {
        tfn: "set",
        bsb: "set",
        accountNumber: "set",
        superFundName: "set",
        superMemberNumber: "set",
      },
    });
    expect(JSON.stringify(saved)).not.toContain("123456789");
  });

  it("stores nulls and records 'cleared' in the audit when a field is left empty", async () => {
    seedRow("emp-1", "tenant-A", { tfnEnc: "v1:stale" });
    const { savePayrollPiiAction } = await load();

    await savePayrollPiiAction(
      "emp-1",
      { status: "idle" },
      fd({
        tfn: "",
        bsb: "",
        accountNumber: "",
        superFundName: "",
        superMemberNumber: "",
      }),
    );

    const row = state.rows.get("emp-1")!;
    expect(row.tfnEnc).toBeNull();
    expect(row.bsbEnc).toBeNull();
    expect(row.accountNumberEnc).toBeNull();
    expect(row.superMemberNumberEnc).toBeNull();
    expect(row.superFundName).toBeNull();

    const saved = state.audits.find(
      (a) => a.action === "shiftcraft.employee.pii_saved",
    );
    expect(saved!.details).toMatchObject({
      fields: {
        tfn: "cleared",
        bsb: "cleared",
        accountNumber: "cleared",
        superFundName: "cleared",
        superMemberNumber: "cleared",
      },
    });
  });

  it("rejects an invalid TFN format with a field error", async () => {
    seedRow("emp-1", "tenant-A");
    const { savePayrollPiiAction } = await load();

    const result = await savePayrollPiiAction(
      "emp-1",
      { status: "idle" },
      fd({ tfn: "abc", bsb: "", accountNumber: "", superFundName: "", superMemberNumber: "" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.tfn).toBeTruthy();
    }
    expect(state.rows.get("emp-1")!.tfnEnc).toBeNull();
    expect(
      state.audits.some((a) => a.action === "shiftcraft.employee.pii_saved"),
    ).toBe(false);
  });

  it("scopes the write to the caller's tenant via forTenant()", async () => {
    seedRow("emp-1", "tenant-A");
    const { savePayrollPiiAction } = await load();

    await savePayrollPiiAction(
      "emp-1",
      { status: "idle" },
      fd({ tfn: "", bsb: "", accountNumber: "", superFundName: "Hostplus", superMemberNumber: "" }),
    );

    expect(state.lastTenantIdForTenant).toBe("tenant-A");
  });
});

describe("revealPayrollPiiAction", () => {
  it("returns the round-trip-decrypted plaintext and writes the reveal audit event", async () => {
    // Seed with a row whose ciphertexts were produced by encryptPii itself,
    // so the action's decryptPii path is exercised end-to-end.
    const { encryptPii } = await import("@tracey/db/pii");
    seedRow("emp-1", "tenant-A", {
      tfnEnc: encryptPii("123456789"),
      bsbEnc: encryptPii("062000"),
      accountNumberEnc: encryptPii("12345678"),
      superFundName: "AustralianSuper",
      superMemberNumberEnc: encryptPii("AS123456"),
    });

    const { revealPayrollPiiAction } = await load();
    const result = await revealPayrollPiiAction("emp-1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({
        tfn: "123456789",
        bsb: "062000",
        accountNumber: "12345678",
        superMemberNumber: "AS123456",
      });
    }

    const revealed = state.audits.find(
      (a) => a.action === "shiftcraft.employee.pii_revealed",
    );
    expect(revealed).toBeDefined();
    expect(revealed!.targetId).toBe("emp-1");
    expect(revealed!.details).toMatchObject({
      fields: ["tfn", "bsb", "accountNumber", "superMemberNumber"],
    });
    // The audit row must never contain the plaintext.
    expect(JSON.stringify(revealed)).not.toContain("123456789");
  });

  it("returns nulls for fields that aren't set, and still audits the reveal attempt", async () => {
    seedRow("emp-1", "tenant-A");
    const { revealPayrollPiiAction } = await load();

    const result = await revealPayrollPiiAction("emp-1");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({
        tfn: null,
        bsb: null,
        accountNumber: null,
        superMemberNumber: null,
      });
    }
    expect(
      state.audits.some((a) => a.action === "shiftcraft.employee.pii_revealed"),
    ).toBe(true);
  });
});
