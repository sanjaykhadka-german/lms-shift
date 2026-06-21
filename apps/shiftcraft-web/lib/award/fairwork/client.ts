import "server-only";
import type {
  FwcAllowanceRow,
  FwcAwardPayload,
  FwcPayRateRow,
} from "@tracey/award";

// Fair Work Commission — Modern Awards Pay Database (MAPD) client (Slice D).
//
// `fetch` only — no SDK, no new dependency. Degrades to a no-op (returns null)
// when FWC_MAPD_API_KEY is absent, mirroring lib/email.ts, so dev/CI/builds
// never break and the feature is simply unavailable until the key is set.
//
// Endpoint shape verified live (2026-06-21):
//   1. GET /awards/{code}                    → paginated version list. Every row
//      carries `award_fixed_id` (the stable id the sub-resources key off — NOT
//      the per-year `award_id`). We pick the latest published version's fixed id.
//   2. GET /awards/{fixed_id}/pay-rates      → classification + rate rows
//   3. GET /awards/{fixed_id}/wage-allowances    → taxable allowances
//   4. GET /awards/{fixed_id}/expense-allowances → reimbursements
// All four are paginated ({_meta:{has_more_results}, results:[…]}); we flatten
// every page and hand the raw arrays to the pure transform in @tracey/award.

const BASE = "https://api.fwc.gov.au/api/v1";
const KEY = process.env.FWC_MAPD_API_KEY;

export function isFairWorkConfigured(): boolean {
  return !!KEY;
}

// Award data changes a few times a year; a generous TTL is fine.
const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { value: FwcAwardPayload; at: number }>();

interface FwcListResponse<T> {
  _meta?: { has_more_results?: boolean; result_count?: number };
  results?: T[];
}

interface FwcAwardVersion {
  award_id?: number;
  award_fixed_id?: number;
  code?: string;
  name?: string;
  published_year?: number;
}

async function fwcGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": KEY as string,
      Accept: "application/json",
    },
    // Authenticated upstream — bypass Next's fetch cache; we cache in-memory.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Fair Work API ${res.status} ${res.statusText} for ${path}`,
    );
  }
  return (await res.json()) as T;
}

// Walk every page of a list endpoint and flatten the rows. Hard page cap is a
// runaway guard — real awards top out around a few hundred rows.
async function fwcList<T>(pathBase: string): Promise<T[]> {
  const out: T[] = [];
  const limit = 100;
  for (let page = 1; page <= 50; page++) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const body = await fwcGet<FwcListResponse<T>>(
      `${pathBase}${sep}page=${page}&limit=${limit}`,
    );
    const rows = body.results ?? [];
    out.push(...rows);
    if (rows.length === 0 || !body._meta?.has_more_results) break;
  }
  return out;
}

export async function fetchAwardPayload(
  awardCode: string,
  asOf: string,
): Promise<FwcAwardPayload | null> {
  if (!KEY) return null; // feature unavailable — no-op
  const cacheKey = `${awardCode}@${asOf}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // 1. Resolve the award's stable fixed id from the version-search endpoint.
  const versions = await fwcList<FwcAwardVersion>(
    `/awards/${encodeURIComponent(awardCode)}`,
  );
  const withFixedId = versions.filter(
    (v): v is FwcAwardVersion & { award_fixed_id: number } =>
      typeof v.award_fixed_id === "number",
  );
  if (withFixedId.length === 0) return null; // unknown award code

  const latest = withFixedId.reduce((a, b) =>
    (b.published_year ?? 0) > (a.published_year ?? 0) ? b : a,
  );
  const fixedId = latest.award_fixed_id;

  // 2. Fetch the rate-set + both allowance lists in parallel, keyed by fixed id.
  const [payRates, wageAllowances, expenseAllowances] = await Promise.all([
    fwcList<FwcPayRateRow>(`/awards/${fixedId}/pay-rates`),
    fwcList<FwcAllowanceRow>(`/awards/${fixedId}/wage-allowances`),
    fwcList<FwcAllowanceRow>(`/awards/${fixedId}/expense-allowances`),
  ]);

  const payload: FwcAwardPayload = {
    code: awardCode,
    name: latest.name,
    payRates,
    wageAllowances,
    expenseAllowances,
  };
  cache.set(cacheKey, { value: payload, at: Date.now() });
  return payload;
}
