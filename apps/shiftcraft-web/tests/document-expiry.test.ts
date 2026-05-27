import { describe, it, expect } from "vitest";
import {
  classifyDocuments,
  EXPIRY_WARN_DAYS,
  summariseExpiry,
} from "../lib/document-expiry";

// Anchor "now" at noon UTC on a known date so day-difference math is
// deterministic across whatever wall clock the test runner happens to
// land on.
const NOW = new Date("2026-06-01T12:00:00Z");

function doc(overrides: {
  id?: string;
  title?: string;
  scope?: "team" | "library";
  employeeId?: string | null;
  expiresAt: Date | null;
}) {
  return {
    id: overrides.id ?? "doc-x",
    title: overrides.title ?? "Doc",
    scope: overrides.scope ?? "team",
    employeeId: overrides.employeeId ?? "emp-1",
    expiresAt: overrides.expiresAt,
  };
}

// Add `days` calendar days to NOW for a target expiry date.
function inDays(days: number, hourOfDay = 9): Date {
  const r = new Date(NOW);
  r.setUTCDate(r.getUTCDate() + days);
  r.setUTCHours(hourOfDay, 0, 0, 0);
  return r;
}

describe("classifyDocuments", () => {
  it("returns an empty result when no docs have expiries", () => {
    const r = classifyDocuments(
      [doc({ expiresAt: null }), doc({ id: "d2", expiresAt: null })],
      NOW,
    );
    expect(r.total).toBe(0);
    for (const tier of ["expired", "lte7", "lte14", "lte30"] as const) {
      expect(r.byTier[tier]).toHaveLength(0);
    }
  });

  it("drops docs whose expiry is beyond the 30-day horizon", () => {
    const r = classifyDocuments(
      [doc({ expiresAt: inDays(31) }), doc({ id: "d2", expiresAt: inDays(60) })],
      NOW,
    );
    expect(r.total).toBe(0);
  });

  it("buckets a doc due today (0 days) into ≤7", () => {
    const r = classifyDocuments(
      [doc({ expiresAt: inDays(0) })],
      NOW,
    );
    expect(r.byTier.lte7).toHaveLength(1);
    expect(r.byTier.lte7[0]!.daysRemaining).toBe(0);
  });

  it("uses calendar-day boundaries: a date at 23:59 today counts as 0 days", () => {
    const r = classifyDocuments(
      [doc({ expiresAt: inDays(0, 23) })],
      NOW,
    );
    expect(r.byTier.lte7[0]!.daysRemaining).toBe(0);
  });

  it("classifies day-7 into ≤7 and day-8 into 8–14", () => {
    const r = classifyDocuments(
      [
        doc({ id: "a", expiresAt: inDays(7) }),
        doc({ id: "b", expiresAt: inDays(8) }),
      ],
      NOW,
    );
    expect(r.byTier.lte7.map((c) => c.doc.id)).toEqual(["a"]);
    expect(r.byTier.lte14.map((c) => c.doc.id)).toEqual(["b"]);
  });

  it("classifies day-14 into 8–14 and day-15 into 15–30", () => {
    const r = classifyDocuments(
      [
        doc({ id: "a", expiresAt: inDays(14) }),
        doc({ id: "b", expiresAt: inDays(15) }),
      ],
      NOW,
    );
    expect(r.byTier.lte14.map((c) => c.doc.id)).toEqual(["a"]);
    expect(r.byTier.lte30.map((c) => c.doc.id)).toEqual(["b"]);
  });

  it("puts a past-expiry doc into the expired tier with a negative remaining count", () => {
    const r = classifyDocuments(
      [doc({ expiresAt: inDays(-3) })],
      NOW,
    );
    expect(r.byTier.expired).toHaveLength(1);
    expect(r.byTier.expired[0]!.daysRemaining).toBe(-3);
  });

  it("sorts each tier soonest-first (expired first = most overdue)", () => {
    const r = classifyDocuments(
      [
        doc({ id: "c", expiresAt: inDays(5) }),
        doc({ id: "a", expiresAt: inDays(1) }),
        doc({ id: "b", expiresAt: inDays(3) }),
        doc({ id: "old1", expiresAt: inDays(-1) }),
        doc({ id: "old2", expiresAt: inDays(-10) }),
      ],
      NOW,
    );
    expect(r.byTier.lte7.map((c) => c.doc.id)).toEqual(["a", "b", "c"]);
    // Most overdue first → -10 before -1.
    expect(r.byTier.expired.map((c) => c.doc.id)).toEqual(["old2", "old1"]);
  });

  it("includes library-scope docs alongside team docs", () => {
    const r = classifyDocuments(
      [
        doc({ id: "team", scope: "team", expiresAt: inDays(2) }),
        doc({
          id: "lib",
          scope: "library",
          employeeId: null,
          expiresAt: inDays(2),
        }),
      ],
      NOW,
    );
    expect(r.total).toBe(2);
    expect(r.byTier.lte7.map((c) => c.doc.id).sort()).toEqual(["lib", "team"]);
  });

  it("EXPIRY_WARN_DAYS const stays at 30", () => {
    expect(EXPIRY_WARN_DAYS).toBe(30);
  });
});

describe("summariseExpiry", () => {
  it("returns null when nothing is expiring", () => {
    const r = classifyDocuments([], NOW);
    expect(summariseExpiry(r)).toBeNull();
  });

  it("formats a multi-tier digest with counts and the first 5 per tier", () => {
    const r = classifyDocuments(
      [
        doc({ id: "a", title: "RSA", expiresAt: inDays(2) }),
        doc({ id: "b", title: "First aid", expiresAt: inDays(10) }),
        doc({ id: "c", title: "Old cert", expiresAt: inDays(-1) }),
      ],
      NOW,
    );
    const summary = summariseExpiry(r);
    expect(summary).toContain("Already expired");
    expect(summary).toContain("Old cert");
    expect(summary).toContain("≤ 7 days");
    expect(summary).toContain("RSA");
    expect(summary).toContain("8–14 days");
    expect(summary).toContain("First aid");
  });

  it("caps each tier listing at 5 with a 'and N more' tail", () => {
    const docs = Array.from({ length: 8 }, (_, i) =>
      doc({ id: `d${i}`, title: `Cert ${i}`, expiresAt: inDays(i + 1) }),
    );
    const r = classifyDocuments(docs, NOW);
    const summary = summariseExpiry(r)!;
    // 7 fall in ≤7d (days 1..7), 1 in 8–14d (day 8).
    expect(summary).toContain("…and 2 more");
  });
});
