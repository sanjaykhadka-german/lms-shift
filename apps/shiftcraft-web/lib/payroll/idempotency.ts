import { createHash } from "node:crypto";
import type { XeroTimesheetInput } from "./xero";

// Derives a stable idempotency key for a week's Xero timesheet export.
//
// The key hashes the payload so that re-exporting the SAME hours yields the
// SAME key — Xero dedupes on it and we never create duplicate timesheets /
// double-pay. Correcting the hours changes the payload hash, so a fresh key
// is produced and the corrected export goes through.
//
// Pure + dependency-light on purpose so it can be unit-tested without the
// xero-node SDK (and so it lives outside the "use server" action file, which
// may only export async functions).
export function deriveXeroIdempotencyKey(
  tenantId: string,
  weekStartIso: string,
  timesheets: XeroTimesheetInput[],
): string {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(timesheets))
    .digest("hex")
    .slice(0, 12);
  return `sc-${tenantId.slice(0, 8)}-${weekStartIso}-${payloadHash}`;
}
