import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// Focuses on signDocumentAction + toggleRequiresSignatureAction (AUDIT.md
// Phase 2 #2c). The upload action itself is covered elsewhere; here we
// assert the signing gates + the audit / hash / IP capture contract.

const state = {
  docs: new Map<
    string,
    {
      id: string;
      scope: "team" | "library";
      employeeId: string | null;
      requiresSignature: boolean;
      data: Buffer;
      title: string;
    }
  >(),
  // employee row keyed by sc_employees.id; resolved from
  // currentUser().id via the app_user_id lookup below.
  employees: new Map<
    string,
    { id: string; appUserId: string; fullName: string }
  >(),
  signatures: [] as Array<{
    documentId: string;
    signerAppUserId: string | null;
    signerEmail: string;
    signerFullName: string;
    signatureText: string;
    signerIp: string | null;
    signerUserAgent: string | null;
    sourceDocumentHash: string;
  }>,
  audits: [] as Array<{
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
  membership: {
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  } as { tenant: { id: string; name: string }; role: string } | null,
  user: {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice Worker",
    image: null,
  } as
    | { id: string; email: string; name: string; image: null }
    | null,
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (Vitest)",
};

function resetState() {
  state.docs.clear();
  state.employees.clear();
  state.signatures = [];
  state.audits = [];
  state.membership = {
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  };
  state.user = {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice Worker",
    image: null,
  };
  state.ip = "203.0.113.7";
  state.userAgent = "Mozilla/5.0 (Vitest)";
}

vi.mock("@tracey/db", () => {
  const TABLE_DOCS = Symbol("scDocuments");
  const TABLE_EMP = Symbol("scEmployees");
  const TABLE_SIGS = Symbol("scDocumentSignatures");
  const scDocuments = {
    __table: TABLE_DOCS,
    id: { __field: "id" },
    scope: { __field: "scope" },
    employeeId: { __field: "employeeId" },
    requiresSignature: { __field: "requiresSignature" },
    data: { __field: "data" },
    title: { __field: "title" },
    traceyTenantId: { __field: "traceyTenantId" },
  };
  const scEmployees = {
    __table: TABLE_EMP,
    id: { __field: "id" },
    fullName: { __field: "fullName" },
    appUserId: { __field: "appUserId" },
    isActive: { __field: "isActive" },
  };
  const scDocumentSignatures = {
    __table: TABLE_SIGS,
    id: { __field: "id" },
    documentId: { __field: "documentId" },
    signerAppUserId: { __field: "signerAppUserId" },
  };
  // The where() helper drizzle returns is opaque. The action uses eq() on
  // various columns; the mock can't introspect those, so we infer intent
  // from the table that was passed to .from() / .insert() / .update().
  let lastFrom: symbol | null = null;
  let lastInsertTable: symbol | null = null;
  return {
    scDocuments,
    scEmployees,
    scDocumentSignatures,
    forTenant: (_tenantId: string) => ({
      tenantId: _tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: (proj?: Record<string, unknown>) => ({
            from: (table: { __table: symbol }) => {
              lastFrom = table.__table;
              return {
                where: () => ({
                  async limit() {
                    if (lastFrom === TABLE_EMP) {
                      // Resolve by appUserId — only one employee per
                      // app_user_id in our seeded data.
                      const match = Array.from(state.employees.values()).find(
                        (e) =>
                          state.user !== null && e.appUserId === state.user.id,
                      );
                      if (!match) return [];
                      return [{ id: match.id, fullName: match.fullName }];
                    }
                    if (lastFrom === TABLE_DOCS) {
                      const doc = Array.from(state.docs.values())[0];
                      if (!doc) return [];
                      if (proj) {
                        const out: Record<string, unknown> = {};
                        for (const k of Object.keys(proj)) {
                          out[k] = (doc as Record<string, unknown>)[k] ?? null;
                        }
                        return [out];
                      }
                      return [doc];
                    }
                    if (lastFrom === TABLE_SIGS) {
                      const docId = state.docs.keys().next().value as string;
                      const sig = state.signatures.find(
                        (s) =>
                          s.documentId === docId &&
                          s.signerAppUserId === state.user?.id,
                      );
                      return sig ? [{ id: "sig-existing" }] : [];
                    }
                    return [];
                  },
                }),
                orderBy: async () => [],
              };
            },
          }),
          insert: (table: { __table: symbol }) => ({
            values: (values: Record<string, unknown>) => {
              lastInsertTable = table.__table;
              if (lastInsertTable === TABLE_SIGS) {
                state.signatures.push({
                  documentId: values.documentId as string,
                  signerAppUserId: (values.signerAppUserId as string) ?? null,
                  signerEmail: (values.signerEmail as string) ?? "",
                  signerFullName: (values.signerFullName as string) ?? "",
                  signatureText: values.signatureText as string,
                  signerIp: (values.signerIp as string | null) ?? null,
                  signerUserAgent:
                    (values.signerUserAgent as string | null) ?? null,
                  sourceDocumentHash: values.sourceDocumentHash as string,
                });
                return {
                  async returning() {
                    return [{ id: `sig-${state.signatures.length}` }];
                  },
                };
              }
              return {
                async returning() {
                  return [];
                },
              };
            },
          }),
          update: (table: { __table: symbol }) => ({
            set: (patch: Record<string, unknown>) => ({
              where: async () => {
                if (table.__table === TABLE_DOCS) {
                  const doc = Array.from(state.docs.values())[0];
                  if (doc && typeof patch.requiresSignature === "boolean") {
                    doc.requiresSignature = patch.requiresSignature;
                  }
                }
                return [];
              },
            }),
          }),
          delete: () => ({ where: async () => [] }),
        };
        return fn(tx);
      },
    }),
  };
});

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => state.membership),
  currentUser: vi.fn(async () => state.user),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input) => {
    state.audits.push(input);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get(name: string) {
      const n = name.toLowerCase();
      if (n === "user-agent") return state.userAgent;
      if (n === "x-forwarded-for") return state.ip;
      if (n === "x-real-ip") return state.ip;
      return null;
    },
  })),
}));

async function load() {
  return await import("../app/app/people/documents/_actions");
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

describe("signDocumentAction", () => {
  it("writes a signature row with hash + IP + UA and audits the event", async () => {
    const data = Buffer.from("contract body bytes");
    const expectedHash = createHash("sha256").update(data).digest("hex");
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: true,
      data,
      title: "Employment contract",
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(result.status).toBe("ok");
    expect(state.signatures).toHaveLength(1);
    expect(state.signatures[0]).toMatchObject({
      documentId: "11111111-1111-1111-1111-111111111111",
      signerAppUserId: "user-1",
      signerEmail: "alice@example.com",
      signerFullName: "Alice Worker",
      signatureText: "Alice Worker",
      signerIp: "203.0.113.7",
      signerUserAgent: "Mozilla/5.0 (Vitest)",
      sourceDocumentHash: expectedHash,
    });
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.document.signed",
    );
    expect(audit).toBeDefined();
    expect(audit!.details).toMatchObject({
      title: "Employment contract",
      sourceDocumentHash: expectedHash,
    });
  });

  it("strips a comma-list x-forwarded-for and stores the leftmost client IP", async () => {
    state.ip = "203.0.113.7, 10.0.0.1, 10.0.0.2";
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: true,
      data: Buffer.from("x"),
      title: "Doc",
    });

    const { signDocumentAction } = await load();
    await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(state.signatures[0]!.signerIp).toBe("203.0.113.7");
  });

  it("rejects when the document doesn't require a signature", async () => {
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: false,
      data: Buffer.from("x"),
      title: "Doc",
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(result.status).toBe("error");
    expect(state.signatures).toHaveLength(0);
  });

  it("rejects when the document belongs to a different employee", async () => {
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "33333333-3333-3333-3333-333333333333",
      requiresSignature: true,
      data: Buffer.from("x"),
      title: "Doc",
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(result.status).toBe("error");
    expect(state.signatures).toHaveLength(0);
  });

  it("treats a re-sign attempt as a no-op (already_signed → ok with message)", async () => {
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: true,
      data: Buffer.from("x"),
      title: "Doc",
    });
    // Pre-seed a prior signature by the same user.
    state.signatures.push({
      documentId: "11111111-1111-1111-1111-111111111111",
      signerAppUserId: "user-1",
      signerEmail: "alice@example.com",
      signerFullName: "Alice Worker",
      signatureText: "Alice Worker",
      signerIp: null,
      signerUserAgent: null,
      sourceDocumentHash: "0".repeat(64),
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.message).toMatch(/already signed/i);
    }
    // No new row.
    expect(state.signatures).toHaveLength(1);
  });

  it("rejects an empty / one-char signature with a field error", async () => {
    state.employees.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      appUserId: "user-1",
      fullName: "Alice Worker",
    });
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: true,
      data: Buffer.from("x"),
      title: "Doc",
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "A" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.signatureText).toBeTruthy();
    }
    expect(state.signatures).toHaveLength(0);
  });

  it("rejects when the viewer has no sc_employees row in this tenant", async () => {
    // No employees seeded — the appUserId lookup returns nothing.
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: true,
      data: Buffer.from("x"),
      title: "Doc",
    });

    const { signDocumentAction } = await load();
    const result = await signDocumentAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", signatureText: "Alice Worker" }),
    );

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toMatch(/couldn't find your employee record/i);
    }
    expect(state.signatures).toHaveLength(0);
  });
});

describe("toggleRequiresSignatureAction", () => {
  it("flips the flag on a team doc and audits the toggle", async () => {
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: false,
      data: Buffer.from("x"),
      title: "Doc",
    });
    const { toggleRequiresSignatureAction } = await load();
    const result = await toggleRequiresSignatureAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", value: "on" }),
    );
    expect(result.status).toBe("ok");
    expect(state.docs.get("11111111-1111-1111-1111-111111111111")!.requiresSignature).toBe(true);
    expect(
      state.audits.some(
        (a) => a.action === "shiftcraft.document.signature_required_toggled",
      ),
    ).toBe(true);
  });

  it("rejects toggling a library-scoped doc", async () => {
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "library",
      employeeId: null,
      requiresSignature: false,
      data: Buffer.from("x"),
      title: "Library doc",
    });
    const { toggleRequiresSignatureAction } = await load();
    const result = await toggleRequiresSignatureAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", value: "on" }),
    );
    expect(result.status).toBe("error");
    expect(state.docs.get("11111111-1111-1111-1111-111111111111")!.requiresSignature).toBe(false);
  });

  it("rejects when the viewer is not Manager+", async () => {
    state.membership = {
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    };
    state.docs.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      scope: "team",
      employeeId: "22222222-2222-2222-2222-222222222222",
      requiresSignature: false,
      data: Buffer.from("x"),
      title: "Doc",
    });
    const { toggleRequiresSignatureAction } = await load();
    const result = await toggleRequiresSignatureAction(
      { status: "idle" },
      fd({ documentId: "11111111-1111-1111-1111-111111111111", value: "on" }),
    );
    expect(result.status).toBe("error");
    expect(state.docs.get("11111111-1111-1111-1111-111111111111")!.requiresSignature).toBe(false);
  });
});
