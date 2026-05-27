// Pure helpers for the document-expiry digest (Feature 1 close-out).
// No DB here — the page does the SELECT and hands the rows to
// `classifyDocuments`, then renders the bucketed result. Keeps the
// boundary classes (Expired / ≤7d / ≤14d / ≤30d) test-only as long as
// nothing else changes.

export const EXPIRY_WARN_DAYS = 30;
export const EXPIRY_TIER_THRESHOLDS = [7, 14, 30] as const;

export type ExpiryTier = "expired" | "lte7" | "lte14" | "lte30";

export const TIER_LABELS: Record<ExpiryTier, string> = {
  expired: "Already expired",
  lte7: "≤ 7 days",
  lte14: "8–14 days",
  lte30: "15–30 days",
};

export interface ExpiringDocInput {
  id: string;
  title: string;
  scope: "team" | "library";
  employeeId: string | null;
  expiresAt: Date | null;
}

export interface ClassifiedDoc<T extends ExpiringDocInput = ExpiringDocInput> {
  doc: T;
  tier: ExpiryTier;
  /** Calendar days remaining (negative once expired). Null if no expiresAt. */
  daysRemaining: number | null;
}

export interface ClassificationResult<T extends ExpiringDocInput = ExpiringDocInput> {
  byTier: Record<ExpiryTier, ClassifiedDoc<T>[]>;
  total: number;
}

/**
 * Bucket a list of docs by expiry urgency relative to `now`.
 * Docs without an `expiresAt`, or whose expiry is more than 30 days out,
 * are dropped — the caller only cares about the digest set.
 *
 * Day math is calendar-based (UTC midnight diffs) so a doc due "tomorrow"
 * shows as 1 even if `now` is 23:59 today. This matches what an operator
 * means when they say "this expires in 3 days".
 */
export function classifyDocuments<T extends ExpiringDocInput>(
  docs: T[],
  now: Date = new Date(),
): ClassificationResult<T> {
  const today = startOfDayUtc(now);
  const result: ClassificationResult<T> = {
    byTier: { expired: [], lte7: [], lte14: [], lte30: [] },
    total: 0,
  };
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const days = calendarDaysBetween(today, d.expiresAt);
    if (days > EXPIRY_WARN_DAYS) continue;
    const tier: ExpiryTier =
      days < 0 ? "expired" : days <= 7 ? "lte7" : days <= 14 ? "lte14" : "lte30";
    result.byTier[tier].push({ doc: d, tier, daysRemaining: days });
    result.total += 1;
  }
  // Sort each tier soonest-first; expired tier sorts most-overdue-first.
  for (const tier of ["expired", "lte7", "lte14", "lte30"] as const) {
    result.byTier[tier].sort(
      (a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0),
    );
  }
  return result;
}

/**
 * Build a short multi-line plaintext summary for the digest email body.
 * Returns null when there's nothing to report so callers can bail before
 * sending.
 */
export function summariseExpiry<T extends ExpiringDocInput>(
  result: ClassificationResult<T>,
): string | null {
  if (result.total === 0) return null;
  const lines: string[] = [];
  const tierOrder: ExpiryTier[] = ["expired", "lte7", "lte14", "lte30"];
  for (const tier of tierOrder) {
    const rows = result.byTier[tier];
    if (rows.length === 0) continue;
    lines.push(`${TIER_LABELS[tier]} (${rows.length}):`);
    for (const r of rows.slice(0, 5)) {
      const days = r.daysRemaining ?? 0;
      const when =
        days < 0
          ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`
          : days === 0
            ? "today"
            : `in ${days} day${days === 1 ? "" : "s"}`;
      lines.push(`  • ${r.doc.title} — ${when}`);
    }
    if (rows.length > 5) {
      lines.push(`  …and ${rows.length - 5} more`);
    }
  }
  return lines.join("\n");
}

function startOfDayUtc(d: Date): Date {
  // Compare in UTC so a tz with a positive offset doesn't shift the
  // "today" boundary unexpectedly on the server. The actual surface
  // (a Date difference in days) is tz-invariant either way; this just
  // makes the "today" anchor reproducible from a test.
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function calendarDaysBetween(from: Date, to: Date): number {
  const toMidnight = startOfDayUtc(to);
  const ms = toMidnight.getTime() - from.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}
