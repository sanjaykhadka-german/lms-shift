import { describe, it, expect } from "vitest";
import {
  resolveBulkCopyTarget,
  type BulkCopySource,
} from "~/app/app/schedule/_bulk-copy";

// resolveBulkCopyTarget is a pure module — no @tracey/db import — so no mock
// needed. All dates are built in local time (new Date(y, m, d, ...)), matching
// how the helper compares calendar days.

// Source: Wed 2026-06-17, 09:00–17:00 (week starts Mon 2026-06-15).
function srcWed(): BulkCopySource {
  return {
    startsAt: new Date(2026, 5, 17, 9, 0),
    endsAt: new Date(2026, 5, 17, 17, 0),
    locationId: "loc-1",
    role: "Butcher",
  };
}
const WEEK_START_MS = new Date(2026, 5, 15).getTime(); // Mon 2026-06-15

function ymdhm(d: Date) {
  return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
}

describe("resolveBulkCopyTarget", () => {
  it("date: copies onto the chosen calendar day, same time-of-day", () => {
    const r = resolveBulkCopyTarget(
      srcWed(),
      { kind: "date", date: "2026-06-22" }, // Mon next week
      WEEK_START_MS,
    );
    expect(r).not.toBeNull();
    expect(ymdhm(r!.startsAt)).toEqual([2026, 5, 22, 9, 0]);
    expect(ymdhm(r!.endsAt)).toEqual([2026, 5, 22, 17, 0]);
    expect(r!.locationId).toBe("loc-1");
    expect(r!.role).toBe("Butcher");
  });

  it("week: keeps the weekday offset within the target week", () => {
    // Source is a Wed; target week starts Mon 2026-06-22 → lands on Wed 06-24.
    const r = resolveBulkCopyTarget(
      srcWed(),
      { kind: "week", weekStart: "2026-06-22" },
      WEEK_START_MS,
    );
    expect(r).not.toBeNull();
    expect(ymdhm(r!.startsAt)).toEqual([2026, 5, 24, 9, 0]);
    expect(ymdhm(r!.endsAt)).toEqual([2026, 5, 24, 17, 0]);
  });

  it("nextWeek: shifts by exactly +7 days, preserving time", () => {
    const r = resolveBulkCopyTarget(srcWed(), { kind: "nextWeek" }, WEEK_START_MS);
    expect(r).not.toBeNull();
    expect(ymdhm(r!.startsAt)).toEqual([2026, 5, 24, 9, 0]);
    expect(ymdhm(r!.endsAt)).toEqual([2026, 5, 24, 17, 0]);
  });

  it("area: keeps dates/times, overrides location + role", () => {
    const r = resolveBulkCopyTarget(
      srcWed(),
      { kind: "area", locationId: "loc-2", role: "Cashier" },
      WEEK_START_MS,
    );
    expect(r).not.toBeNull();
    expect(ymdhm(r!.startsAt)).toEqual([2026, 5, 17, 9, 0]);
    expect(ymdhm(r!.endsAt)).toEqual([2026, 5, 17, 17, 0]);
    expect(r!.locationId).toBe("loc-2");
    expect(r!.role).toBe("Cashier");
  });

  it("dateRange: returns null (expanded into per-day 'date' by the action)", () => {
    expect(
      resolveBulkCopyTarget(
        srcWed(),
        { kind: "dateRange", from: "2026-06-22", to: "2026-06-28" },
        WEEK_START_MS,
      ),
    ).toBeNull();
  });

  it("returns null for a malformed date string", () => {
    expect(
      resolveBulkCopyTarget(srcWed(), { kind: "date", date: "nope" }, WEEK_START_MS),
    ).toBeNull();
    expect(
      resolveBulkCopyTarget(srcWed(), { kind: "week", weekStart: "" }, WEEK_START_MS),
    ).toBeNull();
  });
});
