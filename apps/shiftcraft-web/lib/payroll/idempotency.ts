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
//
// The payload is sorted by employee before hashing so the key is independent
// of the (unordered) DB row order — otherwise the same week hashes differently
// between clicks and the export flaps between a clean replay and a Xero 400
// "Idempotency Key … is used with a different request". The caller MUST send
// the create batch in this same sorted order so key and body stay in lockstep.
//
// The "sc2-" scheme prefix deliberately differs from the original "sc-" keys:
// keys from the pre-reconcile code can linger in Xero's ~24h idempotency cache
// and a fresh key derived from the same data could otherwise collide with one,
// 400-ing a perfectly valid export. Bumping the scheme sidesteps that without
// waiting the window out.
export function sortTimesheetsForKey(
  timesheets: XeroTimesheetInput[],
): XeroTimesheetInput[] {
  return [...timesheets].sort((a, b) =>
    a.xeroEmployeeId.localeCompare(b.xeroEmployeeId),
  );
}

export function deriveXeroIdempotencyKey(
  tenantId: string,
  weekStartIso: string,
  timesheets: XeroTimesheetInput[],
): string {
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(sortTimesheetsForKey(timesheets)))
    .digest("hex")
    .slice(0, 12);
  return `sc2-${tenantId.slice(0, 8)}-${weekStartIso}-${payloadHash}`;
}
