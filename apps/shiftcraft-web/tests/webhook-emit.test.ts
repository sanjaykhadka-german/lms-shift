import { describe, it, expect, beforeEach, vi } from "vitest";

interface Sub {
  id: string;
  url: string;
  secret: string;
}

interface Delivery {
  id: string;
  subscriptionId: string;
  status: "pending" | "succeeded" | "failed";
  responseStatus: number | null;
  responseBodyExcerpt: string | null;
  lastError: string | null;
  attemptCount: number;
}

interface SubUpdate {
  subscriptionId: string;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
}

const state = {
  subscriptions: [] as Sub[],
  deliveries: [] as Delivery[],
  subUpdates: [] as SubUpdate[],
  fetchCalls: [] as Array<{ url: string; body: string; signature: string }>,
  selectIdx: 0,
  // Override fetch behaviour per test.
  fetchResolver: null as
    | null
    | ((url: string) => Promise<Response> | Response),
};

function reset() {
  state.subscriptions = [];
  state.deliveries = [];
  state.subUpdates = [];
  state.fetchCalls = [];
  state.selectIdx = 0;
  state.fetchResolver = null;
}

// emitWebhook does ONE select (active subs) inside its first run().
// deliverOnce makes another run() that does an INSERT.RETURNING.
// persistResult does a third run() that does an UPDATE + UPDATE.
// Each .run() call gets its own sequence-tracked tx.
let runCallIdx = 0;

vi.mock("@tracey/db", () => {
  const cols = (fields: string[]) =>
    Object.fromEntries(fields.map((f) => [f, { __field: f }])) as Record<
      string,
      { __field: string }
    >;
  return {
    scWebhookSubscriptions: cols([
      "id",
      "traceyTenantId",
      "event",
      "url",
      "secret",
      "isActive",
    ]),
    scWebhookDeliveries: cols([
      "id",
      "traceyTenantId",
      "subscriptionId",
      "event",
      "payload",
      "status",
    ]),
    forTenant: () => ({
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const myIdx = runCallIdx;
        runCallIdx += 1;
        const tx = {
          select: () => {
            // First run() in emitWebhook: subscription lookup.
            // Subsequent runs don't select.
            const whereChain = {
              limit: async () => state.subscriptions,
              then(
                onF: (v: unknown[]) => unknown,
                onR?: (e: unknown) => unknown,
              ) {
                return Promise.resolve(state.subscriptions as unknown[]).then(
                  onF,
                  onR,
                );
              },
            };
            return {
              from: () => ({
                where: () => whereChain,
                leftJoin: () => ({ where: () => whereChain }),
                innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
              }),
            };
          },
          insert: () => ({
            values: (v: { subscriptionId: string }) => ({
              returning: async () => {
                const id = `delivery-${state.deliveries.length + 1}`;
                state.deliveries.push({
                  id,
                  subscriptionId: v.subscriptionId,
                  status: "pending",
                  responseStatus: null,
                  responseBodyExcerpt: null,
                  lastError: null,
                  attemptCount: 1,
                });
                return [{ id }];
              },
            }),
          }),
          update: () => ({
            set: (patch: Record<string, unknown>) => ({
              where: async () => {
                // We don't have the where-clause id in the harness, so
                // we identify deliveries by the most recent insert when
                // status / responseStatus are present, and subs by
                // lastSuccessAt / lastFailureAt presence.
                if ("status" in patch) {
                  const target = state.deliveries[state.deliveries.length - 1];
                  if (target) {
                    target.status = patch.status as Delivery["status"];
                    target.responseStatus =
                      (patch.responseStatus as number | null) ?? null;
                    target.responseBodyExcerpt =
                      (patch.responseBodyExcerpt as string | null) ?? null;
                    target.lastError =
                      (patch.lastError as string | null) ?? null;
                  }
                } else if (
                  "lastSuccessAt" in patch ||
                  "lastFailureAt" in patch
                ) {
                  const target = state.deliveries[state.deliveries.length - 1];
                  state.subUpdates.push({
                    subscriptionId: target?.subscriptionId ?? "",
                    lastSuccessAt: patch.lastSuccessAt as Date | undefined,
                    lastFailureAt: patch.lastFailureAt as Date | undefined,
                  });
                }
                return undefined;
              },
            }),
          }),
        };
        return fn(tx);
      },
    }),
  };
});

const { emitWebhook } = await import("~/lib/webhooks");

const stubResponse = (status: number, body = "ok"): Response =>
  new Response(body, { status });

beforeEach(() => {
  reset();
  runCallIdx = 0;
});

function addSub(url: string, secret: string): Sub {
  const sub: Sub = {
    id: `sub-${state.subscriptions.length + 1}`,
    url,
    secret,
  };
  state.subscriptions.push(sub);
  return sub;
}

const okFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input as URL).toString();
  const body = String(init?.body ?? "");
  const headers = init?.headers as Record<string, string> | undefined;
  state.fetchCalls.push({
    url,
    body,
    signature: headers?.["x-webhook-signature"] ?? "",
  });
  return stubResponse(200);
};

const failFetch: typeof fetch = async () => stubResponse(500, "boom");

const throwFetch: typeof fetch = async () => {
  throw new Error("ECONNREFUSED");
};

describe("emitWebhook", () => {
  it("no-ops cleanly when no active subscriptions match", async () => {
    await emitWebhook("tenant-A", "timesheet.approved", { foo: 1 }, {
      fetchImpl: okFetch,
    });
    expect(state.deliveries).toHaveLength(0);
    expect(state.fetchCalls).toHaveLength(0);
  });

  it("inserts a delivery + POSTs + marks succeeded for a 200 receiver", async () => {
    addSub("https://example.com/hook", "secret-secret-secret-secret");
    await emitWebhook(
      "tenant-A",
      "timesheet.approved",
      { weekStart: "2026-05-25" },
      { fetchImpl: okFetch },
    );
    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]?.status).toBe("succeeded");
    expect(state.deliveries[0]?.responseStatus).toBe(200);
    expect(state.fetchCalls).toHaveLength(1);
    expect(state.fetchCalls[0]?.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(state.subUpdates[0]?.lastSuccessAt).toBeInstanceOf(Date);
  });

  it("fans out across multiple subscriptions for the same event", async () => {
    addSub("https://a.example/hook", "secret-secret-secret-secret");
    addSub("https://b.example/hook", "secret-secret-secret-secret-2");
    await emitWebhook(
      "tenant-A",
      "shift.published",
      { shiftId: "x" },
      { fetchImpl: okFetch },
    );
    expect(state.deliveries).toHaveLength(2);
    expect(state.fetchCalls.map((c) => c.url).sort()).toEqual([
      "https://a.example/hook",
      "https://b.example/hook",
    ]);
  });

  it("marks the delivery failed when the receiver returns 5xx", async () => {
    addSub("https://example.com/hook", "secret-secret-secret-secret");
    await emitWebhook(
      "tenant-A",
      "employee.created",
      { employeeId: "e1" },
      { fetchImpl: failFetch },
    );
    expect(state.deliveries[0]?.status).toBe("failed");
    expect(state.deliveries[0]?.responseStatus).toBe(500);
    expect(state.deliveries[0]?.lastError).toBe("HTTP 500");
    expect(state.subUpdates[0]?.lastFailureAt).toBeInstanceOf(Date);
  });

  it("marks failed without throwing when fetch itself rejects", async () => {
    addSub("https://example.com/hook", "secret-secret-secret-secret");
    await emitWebhook(
      "tenant-A",
      "employee.created",
      { employeeId: "e2" },
      { fetchImpl: throwFetch },
    );
    expect(state.deliveries[0]?.status).toBe("failed");
    expect(state.deliveries[0]?.lastError).toBe("ECONNREFUSED");
  });

  it("does not throw to the caller even if one of N receivers fails", async () => {
    addSub("https://ok.example/hook", "secret-secret-secret-secret");
    addSub("https://fail.example/hook", "secret-secret-secret-secret-2");
    const calls: string[] = [];
    const mixedFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes("fail")) throw new Error("nope");
      return stubResponse(200);
    };
    // The test harness's per-row update tracking gets confused when
    // multiple deliveries race in parallel — but the important
    // guarantee from emitWebhook's caller perspective is that the
    // *outer* promise resolves cleanly regardless of receiver fate
    // AND every receiver got an HTTP attempt. Per-row succeeded/
    // failed labelling is covered by the single-sub tests above.
    await expect(
      emitWebhook("tenant-A", "shift.published", {}, { fetchImpl: mixedFetch }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(calls.some((u) => u.includes("ok.example"))).toBe(true);
    expect(calls.some((u) => u.includes("fail.example"))).toBe(true);
  });
});
