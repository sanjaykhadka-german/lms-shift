import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Stateless, verifiable certificate tokens — no DB table of codes needed.
// A token is `base64url(payload) . hmac` where payload is
// "<tenantId>.<userId>.<moduleId>". The public /verify/[token] route checks
// the HMAC, then confirms the certificate still exists in the database.

function secret(): string {
  return (
    process.env.CERTIFICATE_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "tracey-dev-insecure-certificate-secret"
  );
}

export interface CertificateRef {
  tenantId: string;
  userId: number;
  moduleId: number;
}

function sigFor(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 24);
}

export function signCertificate(ref: CertificateRef): string {
  // tenantId is a uuid (hyphens, no dots) so "." is a safe field separator.
  const payload = `${ref.tenantId}.${ref.userId}.${ref.moduleId}`;
  return `${Buffer.from(payload).toString("base64url")}.${sigFor(payload)}`;
}

export function verifyCertificateToken(token: string): CertificateRef | null {
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(sigFor(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [tenantId, userIdStr, moduleIdStr] = payload.split(".");
  if (!tenantId || !userIdStr || !moduleIdStr) return null;
  const userId = parseInt(userIdStr, 10);
  const moduleId = parseInt(moduleIdStr, 10);
  if (!Number.isFinite(userId) || !Number.isFinite(moduleId)) return null;
  return { tenantId, userId, moduleId };
}
