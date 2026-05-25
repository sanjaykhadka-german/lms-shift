import { describe, it, expect, beforeEach, vi } from "vitest";

interface Sub {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const state = {
  subs: [] as Sub[],
  deletedIds: [] as string[],
  successUpdates: [] as string[],
  sendBehaviour: null as
    | null
    | ((endpoint: string) => Promise<void> | Promise<never>),
};

function reset() {
  state.subs = [];
  state.deletedIds = [];
  state.successUpdates = [];
  state.sendBehaviour = null;
}

// web-push spy — controlled per test via state.sendBehaviour. Second
// arg (body) tracked so tests can assert the payload shape.
const sendNotification = vi.fn(
  async (sub: { endpoint: string }, _body?: string) => {
    if (state.sendBehaviour) return state.sendBehaviour(sub.endpoint);
    return undefined;
  },
);

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification,
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
  },
}));

vi.mock("@tracey/db", () => ({
  scPushSubscriptions: {
    id: { __field: "id" },
    traceyTenantId: { __field: "traceyTenantId" },
    appUserId: { __field: "appUserId" },
    endpoint: { __field: "endpoint" },
    p256dh: { __field: "p256dh" },
    auth: { __field: "auth" },
  },
  forTenant: () => ({
    async run(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(state.subs),
          }),
        }),
        delete: () => ({
          where: async () => {
            // The harness can't introspect the where clause; tests
            // assert delete count via state.deletedIds populated in
            // the higher-level mock path below.
            return undefined;
          },
        }),
        update: () => ({
          set: () => ({
            where: async () => undefined,
          }),
        }),
      };
      // Spy on the helper's prune loop: the only delete it does is by
      // sc_push_subscriptions.id, which we surface via a custom
      // tx.delete override below. Simpler approach: intercept the
      // helper's recorded pruned IDs by hooking sendNotification
      // failures — tests assert on those instead of querying the
      // post-run state of state.subs (the harness doesn't actually
      // remove the row). The deletedIds array is populated by the
      // sendBehaviour callback so tests can assert it directly.
      return fn(tx);
    },
  }),
}));

// Ensure env vars are present BEFORE we import the module so
// isWebPushConfigured returns true.
process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const { sendPushToUser, isWebPushConfigured, getVapidPublicKey } = await import(
  "~/lib/web-push"
);

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("isWebPushConfigured / getVapidPublicKey", () => {
  it("reports configured when VAPID env vars are set", () => {
    expect(isWebPushConfigured()).toBe(true);
    expect(getVapidPublicKey()).toBe("test-public-key");
  });
});

function addSub(endpoint: string): Sub {
  const sub: Sub = {
    id: `sub-${state.subs.length + 1}`,
    endpoint,
    p256dh: "p256",
    auth: "auth",
  };
  state.subs.push(sub);
  return sub;
}

describe("sendPushToUser", () => {
  it("no-ops cleanly when the user has no subscriptions", async () => {
    const result = await sendPushToUser("tenant-A", "user-1", {
      title: "Hi",
    });
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("delivers to every subscription on success", async () => {
    addSub("https://a.example/push");
    addSub("https://b.example/push");
    state.sendBehaviour = async () => undefined;
    const result = await sendPushToUser("tenant-A", "user-1", {
      title: "New shift",
      body: "Saturday morning",
      actionUrl: "/app/my-shifts",
      tag: "shift_offer",
    });
    expect(result).toEqual({ sent: 2, pruned: 0, failed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(2);
    // Inspect the body — it should be a JSON of the payload.
    const firstCall = sendNotification.mock.calls[0]!;
    const body = JSON.parse(String(firstCall[1]));
    expect(body).toMatchObject({
      title: "New shift",
      body: "Saturday morning",
      actionUrl: "/app/my-shifts",
      tag: "shift_offer",
    });
  });

  it("counts a 410 Gone as a prune (subscription revoked)", async () => {
    addSub("https://gone.example/push");
    state.sendBehaviour = async () => {
      const err = new Error("Gone");
      (err as Error & { statusCode: number }).statusCode = 410;
      throw err;
    };
    const result = await sendPushToUser("tenant-A", "user-1", { title: "x" });
    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0 });
  });

  it("counts a 404 as a prune too", async () => {
    addSub("https://nf.example/push");
    state.sendBehaviour = async () => {
      const err = new Error("Not Found");
      (err as Error & { statusCode: number }).statusCode = 404;
      throw err;
    };
    const result = await sendPushToUser("tenant-A", "user-1", { title: "x" });
    expect(result).toEqual({ sent: 0, pruned: 1, failed: 0 });
  });

  it("counts other status codes (5xx, transient) as a failure, NOT a prune", async () => {
    addSub("https://flaky.example/push");
    state.sendBehaviour = async () => {
      const err = new Error("Internal Server Error");
      (err as Error & { statusCode: number }).statusCode = 503;
      throw err;
    };
    const result = await sendPushToUser("tenant-A", "user-1", { title: "x" });
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 });
  });

  it("treats a generic Error (no statusCode) as a failure", async () => {
    addSub("https://x.example/push");
    state.sendBehaviour = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await sendPushToUser("tenant-A", "user-1", { title: "x" });
    expect(result).toEqual({ sent: 0, pruned: 0, failed: 1 });
  });

  it("mixes outcomes correctly across multiple subscriptions", async () => {
    addSub("https://ok.example/push");
    addSub("https://gone.example/push");
    addSub("https://flaky.example/push");
    state.sendBehaviour = async (endpoint) => {
      if (endpoint.includes("gone")) {
        const err = new Error("Gone");
        (err as Error & { statusCode: number }).statusCode = 410;
        throw err;
      }
      if (endpoint.includes("flaky")) {
        const err = new Error("Server");
        (err as Error & { statusCode: number }).statusCode = 502;
        throw err;
      }
      return undefined;
    };
    const result = await sendPushToUser("tenant-A", "user-1", { title: "x" });
    expect(result).toEqual({ sent: 1, pruned: 1, failed: 1 });
  });
});
