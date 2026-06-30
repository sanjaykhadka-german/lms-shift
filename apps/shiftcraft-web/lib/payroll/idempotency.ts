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

// `attempt` salts the hash. It defaults to 0, which reproduces the original
// content-only key — so a normal re-export of identical hours still yields the
// same key and Xero dedupes it (no double pay). A non-zero attempt is used
// ONLY by the create-recovery path: when Xero 400s with "Idempotency Key … is
// used with a different request" (a key lingering in Xero's ~24h cache from an
// earlier push of the same week — e.g. after the timesheet was deleted in Xero
// and re-created), we retry with attempt+1 to mint a fresh key. This is safe
// against duplicates because Xero independently rejects a second timesheet for
// the same employee+period with "already exists" — so a salted retry can only
// succeed when nothing is actually there to duplicate.
export function deriveXeroIdempotencyKey(
  tenantId: string,
  weekStartIso: string,
  timesheets: XeroTimesheetInput[],
  attempt = 0,
): string {
  const sorted = sortTimesheetsForKey(timesheets);
  const basis = attempt > 0 ? { attempt, sorted } : sorted;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(basis))
    .digest("hex")
    .slice(0, 12);
  return `sc2-${tenantId.slice(0, 8)}-${weekStartIso}-${payloadHash}`;
}
