import "server-only";
import type { FwcAwardPayload } from "@tracey/award";

// Fair Work Commission — Modern Awards Pay Database (MAPD) client (Slice D).
//
// `fetch` only — no SDK, no new dependency. Degrades to a no-op (returns null)
// when FWC_MAPD_API_KEY is absent, mirroring lib/email.ts, so dev/CI/builds
// never break and the feature is simply unavailable until the key is set.
//
// ⚠️ Base URL + endpoint paths + response field names are CODED AGAINST THE
// DOCUMENTED SHAPE and flagged `FWC: confirm`. Confirm via the authenticated
// developer.fwc.gov.au portal ("Try it out") + the Data dictionary, then adjust
// the URL(s) below and the FwcAwardPayload mapping. The MAPD likely needs
// several calls (classifications, pay-rates, allowances) assembled into one
// FwcAwardPayload — assemble them here.

const BASE = "https://api.fwc.gov.au/api/v1"; // FWC: confirm base
const KEY = process.env.FWC_MAPD_API_KEY;

export function isFairWorkConfigured(): boolean {
  return !!KEY;
}

// Small module-level TTL cache (mirrors lib/holidays.ts). Award data changes
// at most a few times a year, so a generous TTL is fine.
const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { value: FwcAwardPayload; at: number }>();

export async function fetchAwardPayload(
  awardCode: string,
  asOf: string,
): Promise<FwcAwardPayload | null> {
  if (!KEY) return null; // feature unavailable — no-op
  const cacheKey = `${awardCode}@${asOf}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // FWC: confirm the exact endpoint(s) + query params. Single call assumed here;
  // split into classifications / pay-rates / allowances calls if required and
  // merge into one FwcAwardPayload before returning.
  const url = `${BASE}/awards/${encodeURIComponent(awardCode)}?operativeFrom=${encodeURIComponent(asOf)}`;
  const res = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": KEY,
      Accept: "application/json",
    },
    // Avoid Next's fetch cache for an authenticated upstream; we cache in-memory.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Fair Work API ${res.status} ${res.statusText} for ${awardCode}`,
    );
  }
  const body = (await res.json()) as unknown;
  const payload = normalizePayload(awardCode, body);
  cache.set(cacheKey, { value: payload, at: Date.now() });
  return payload;
}

// Maps the raw API body onto FwcAwardPayload. Kept thin + defensive so a shape
// surprise degrades to empty arrays rather than throwing. FWC: confirm the
// top-level field names (the cast below is the single place to fix).
function normalizePayload(awardCode: string, body: unknown): FwcAwardPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    code: awardCode,
    name: typeof b.name === "string" ? b.name : undefined,
    operativeFrom:
      typeof b.operativeFrom === "string" ? b.operativeFrom : undefined,
    ordinaryHoursPerWeek:
      typeof b.ordinaryHoursPerWeek === "number"
        ? b.ordinaryHoursPerWeek
        : undefined,
    classifications: Array.isArray(b.classifications)
      ? (b.classifications as FwcAwardPayload["classifications"])
      : [],
    wageAllowances: Array.isArray(b.wageAllowances)
      ? (b.wageAllowances as FwcAwardPayload["wageAllowances"])
      : [],
    expenseAllowances: Array.isArray(b.expenseAllowances)
      ? (b.expenseAllowances as FwcAwardPayload["expenseAllowances"])
      : [],
  };
}
