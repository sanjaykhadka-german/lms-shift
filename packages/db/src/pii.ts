// PII envelope-encryption helper for at-rest secrets (TFN, BSB+account,
// super-fund member numbers, etc).
//
// Why this file exists
// --------------------
// ShiftCraft's onboarding flow needs to capture AU tax-file numbers,
// bank account details, and super-fund identifiers. These must never be
// stored in plaintext, logged, or returned in list endpoints. AUDIT.md
// §4 lists "PII encryption at rest" as the blocker for completing
// Feature 1 (employee onboarding) and Feature 5 (payroll export).
//
// Approach
// --------
// AES-256-GCM via Node's built-in `crypto` module. Authenticated
// encryption (GCM mode) lets `decryptPii` reject tampered ciphertext.
// A fresh 12-byte IV is generated per call, so the same plaintext
// encrypts to a different token each time. Output is a single string
// `v1:<base64(iv|tag|ciphertext)>` so future key/cipher rotation can
// ship as a "v2" branch without breaking stored rows.
//
// Why Node crypto and not pgcrypto
// --------------------------------
// AUDIT.md proposed a pgcrypto wrapper. Doing the work in Node instead
// buys two things: (a) unit tests run under vitest without a live
// Postgres, and (b) key material never appears in SQL statements sent
// over the wire. The trade-off is that decryption must happen
// application-side and PII can't appear in WHERE clauses — but PII
// never should anyway.
//
// Key management
// --------------
// `TRACEY_PII_ENC_KEY`: base64-encoded 32 random bytes (256 bits).
//   Generate with:  openssl rand -base64 32
// The application hard-fails at first use if the var is missing or the
// wrong length — no silent degradation, no insecure fallback. Rotate
// by generating a new key, adding a "v2" branch here, and re-encrypting
// existing rows in a one-shot migration.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = "v1";

let cachedKey: Buffer | undefined;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TRACEY_PII_ENC_KEY;
  if (!raw) {
    throw new Error(
      "TRACEY_PII_ENC_KEY env var is required for PII encryption. " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `TRACEY_PII_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  cachedKey = key;
  return key;
}

// Test-only: clear the cached key so a spec can mutate process.env between cases.
export function _resetPiiKeyCache(): void {
  cachedKey = undefined;
}

// Encrypts a plaintext for at-rest storage. Returns a `v1:...` token, or
// `null` when the input is null/undefined/empty — callers don't have to
// branch on empty optional fields.
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") return null;
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv) as CipherGCM;
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
}

// Decrypts a token produced by `encryptPii`. Throws on tampered or
// malformed input. Pass null through unchanged.
//
// Never log the return value. For "reveal on click" UIs, gate the call
// behind an audit event (action: "pii.revealed", target: column name).
export function decryptPii(token: string | null | undefined): string | null {
  if (token == null || token === "") return null;
  const sep = token.indexOf(":");
  if (sep <= 0) throw new Error("Malformed PII token: missing version prefix");
  const version = token.slice(0, sep);
  const payload = token.slice(sep + 1);
  if (version !== VERSION) {
    throw new Error(`Unsupported PII token version: ${version}`);
  }
  if (!payload) throw new Error("Malformed PII token: empty payload");
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Malformed PII token: payload too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, getKey(), iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// Pure UI helper. Returns "•••• 1234" with the last `visible` chars in
// the clear, or "••••" when the value is too short to keep any tail.
// No key required — safe to call in RSC list views with already-
// decrypted values.
export function maskPii(
  plaintext: string | null | undefined,
  visible = 4,
): string {
  if (plaintext == null || plaintext === "") return "";
  if (plaintext.length <= visible) return "••••";
  return `•••• ${plaintext.slice(-visible)}`;
}
