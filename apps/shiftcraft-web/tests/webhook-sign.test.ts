import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scWebhookSubscriptions: {},
  scWebhookDeliveries: {},
}));

const {
  generateWebhookSecret,
  signWebhookBody,
  verifyWebhookSignature,
  isKnownWebhookEvent,
  WEBHOOK_EVENTS,
} = await import("~/lib/webhooks");

describe("generateWebhookSecret", () => {
  it("returns a hex string ≥ 16 chars (DB check-constraint contract)", () => {
    const s = generateWebhookSecret();
    expect(s.length).toBeGreaterThanOrEqual(16);
    expect(s).toMatch(/^[0-9a-f]+$/);
  });

  it("returns 32 bytes (64 hex chars) by default", () => {
    expect(generateWebhookSecret()).toHaveLength(64);
  });

  it("returns distinct values across calls", () => {
    const samples = new Set<string>();
    for (let i = 0; i < 20; i += 1) samples.add(generateWebhookSecret());
    expect(samples.size).toBe(20);
  });
});

describe("signWebhookBody", () => {
  it("emits sha256=<hex> with HMAC-SHA256 of the body", () => {
    const secret = "test-secret-32-chars-minimum-aaaaa";
    const body = '{"event":"timesheet.approved","data":{"x":1}}';
    const expected =
      "sha256=" +
      createHmac("sha256", secret).update(body).digest("hex");
    expect(signWebhookBody(secret, body)).toBe(expected);
  });

  it("changes when the body changes", () => {
    const s = "secret-secret-secret-secret";
    expect(signWebhookBody(s, "a")).not.toBe(signWebhookBody(s, "b"));
  });

  it("changes when the secret changes", () => {
    const body = '{"event":"shift.published"}';
    expect(signWebhookBody("aaaaaaaaaaaaaaaa", body)).not.toBe(
      signWebhookBody("bbbbbbbbbbbbbbbb", body),
    );
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "secret-secret-secret-secret";
  const body = '{"hello":"world"}';

  it("accepts a header that matches", () => {
    const header = signWebhookBody(secret, body);
    expect(verifyWebhookSignature(secret, body, header)).toBe(true);
  });

  it("rejects a header signed with a different secret", () => {
    const header = signWebhookBody("other-other-other-other", body);
    expect(verifyWebhookSignature(secret, body, header)).toBe(false);
  });

  it("rejects when the body has been tampered with", () => {
    const header = signWebhookBody(secret, body);
    expect(verifyWebhookSignature(secret, '{"hello":"WORLD"}', header)).toBe(
      false,
    );
  });

  it("rejects a length-mismatched header without throwing", () => {
    expect(verifyWebhookSignature(secret, body, "sha256=short")).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifyWebhookSignature(secret, body, "")).toBe(false);
    expect(verifyWebhookSignature(secret, body, "not-a-signature")).toBe(false);
  });
});

describe("isKnownWebhookEvent + WEBHOOK_EVENTS", () => {
  it("accepts each known event", () => {
    for (const e of WEBHOOK_EVENTS) {
      expect(isKnownWebhookEvent(e)).toBe(true);
    }
  });

  it("rejects unknown event names", () => {
    expect(isKnownWebhookEvent("not.a.real.event")).toBe(false);
    expect(isKnownWebhookEvent("")).toBe(false);
    expect(isKnownWebhookEvent("Timesheet.Approved")).toBe(false);
  });

  it("includes the three audit-mandated events", () => {
    expect(WEBHOOK_EVENTS).toContain("timesheet.approved");
    expect(WEBHOOK_EVENTS).toContain("employee.created");
    expect(WEBHOOK_EVENTS).toContain("shift.published");
  });
});
