import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// `@tracey/db/pii` is a dedicated subpath export so importing it does NOT
// pull in client.ts (which side-effects on DATABASE_URL at module load).
import {
  _resetPiiKeyCache,
  decryptPii,
  encryptPii,
  maskPii,
} from "@tracey/db/pii";

const VALID_KEY = randomBytes(32).toString("base64");

describe("pii encryption", () => {
  const originalKey = process.env.TRACEY_PII_ENC_KEY;

  beforeEach(() => {
    process.env.TRACEY_PII_ENC_KEY = VALID_KEY;
    _resetPiiKeyCache();
  });

  afterEach(() => {
    process.env.TRACEY_PII_ENC_KEY = originalKey;
    _resetPiiKeyCache();
  });

  it("round-trips plaintext through encrypt/decrypt", () => {
    const plain = "123 456 789"; // pretend TFN
    const token = encryptPii(plain);
    expect(token).not.toBeNull();
    expect(token!.startsWith("v1:")).toBe(true);
    expect(token).not.toContain(plain);
    expect(decryptPii(token)).toBe(plain);
  });

  it("produces a different ciphertext on every call (random IV)", () => {
    const a = encryptPii("BSB 062-000 ACC 12345678");
    const b = encryptPii("BSB 062-000 ACC 12345678");
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe(decryptPii(b));
  });

  it("passes null/undefined/empty through unchanged on encrypt", () => {
    expect(encryptPii(null)).toBeNull();
    expect(encryptPii(undefined)).toBeNull();
    expect(encryptPii("")).toBeNull();
  });

  it("passes null/undefined/empty through unchanged on decrypt", () => {
    expect(decryptPii(null)).toBeNull();
    expect(decryptPii(undefined)).toBeNull();
    expect(decryptPii("")).toBeNull();
  });

  it("rejects a token with a tampered ciphertext byte", () => {
    const token = encryptPii("super sensitive")!;
    // Flip a bit in the base64 payload by replacing one mid-string char.
    const [prefix, payload] = token.split(":", 2);
    const flipped = payload!.slice(0, 20) +
      (payload!.charAt(20) === "A" ? "B" : "A") +
      payload!.slice(21);
    expect(() => decryptPii(`${prefix}:${flipped}`)).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    const token = encryptPii("x")!;
    const payload = token.slice(token.indexOf(":") + 1);
    expect(() => decryptPii(`v9:${payload}`)).toThrow(/version/i);
  });

  it("rejects a malformed (too short) payload", () => {
    expect(() => decryptPii("v1:AAAA")).toThrow();
  });

  it("throws a clear error when TRACEY_PII_ENC_KEY is missing", () => {
    delete process.env.TRACEY_PII_ENC_KEY;
    _resetPiiKeyCache();
    expect(() => encryptPii("x")).toThrow(/TRACEY_PII_ENC_KEY/);
  });

  it("throws when TRACEY_PII_ENC_KEY decodes to the wrong length", () => {
    process.env.TRACEY_PII_ENC_KEY = Buffer.from("too short").toString("base64");
    _resetPiiKeyCache();
    expect(() => encryptPii("x")).toThrow(/32 bytes/);
  });
});

describe("maskPii", () => {
  it("shows the last 4 chars by default", () => {
    expect(maskPii("123456789")).toBe("•••• 6789");
  });

  it("accepts a custom visible-tail length", () => {
    expect(maskPii("123456789", 2)).toBe("•••• 89");
  });

  it("returns full-mask when the value is shorter than visible tail", () => {
    expect(maskPii("12", 4)).toBe("••••");
    expect(maskPii("1234", 4)).toBe("••••");
  });

  it("returns empty string for null / undefined / empty", () => {
    expect(maskPii(null)).toBe("");
    expect(maskPii(undefined)).toBe("");
    expect(maskPii("")).toBe("");
  });
});
