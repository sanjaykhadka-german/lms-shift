import { describe, it, expect, vi } from "vitest";

// The aggregator imports lib/clock which re-exports @tracey/db symbols;
// stub the package so the test runs without DATABASE_URL.
vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scClockEvents: {},
}));

const { buildScoreboard, LATE_GRACE_MS, OT_GRACE_MS } = await import(
  "../lib/attendance-scoreboard"
);

const at = (iso: string) => new Date(iso);

describe("buildScoreboard", () => {
  it("returns empty when there are no shifts and no events", () => {
    const out = buildScoreboard({
      shifts: [],
      events: [],
      approvedWeeks: new Set(),
    });
    expect(out.size).toBe(0);
  });

  it("counts on-time attendance and no lateness", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"),
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: "loc-a",
    };
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: at("2026-05-25T08:58:00Z") },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T17:00:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    const s = out.get("u1")!;
    expect(s.scheduled).toBe(1);
    expect(s.attended).toBe(1);
    expect(s.noShows).toBe(0);
    expect(s.lateCount).toBe(0);
    expect(s.unapprovedOtMs).toBe(0);
  });

  it("flags lateness when first in lands past the grace window", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"),
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: null,
    };
    // 12 min late — well past the 5-min default grace.
    const lateBy = 12 * 60_000;
    const firstIn = at(new Date(shift.startsAt.getTime() + lateBy).toISOString());
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: firstIn },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T17:00:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    const s = out.get("u1")!;
    expect(s.lateCount).toBe(1);
    expect(s.lateMs).toBe(lateBy);
  });

  it("does not flag lateness inside the grace window", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"),
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: null,
    };
    // 4 min late — under the 5-min grace.
    const within = at(
      new Date(shift.startsAt.getTime() + 4 * 60_000).toISOString(),
    );
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: within },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T17:00:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    expect(out.get("u1")!.lateCount).toBe(0);
    // Sanity — the grace const matches the test premise.
    expect(LATE_GRACE_MS).toBe(5 * 60_000);
  });

  it("counts a shift with no clock activity as a no-show", () => {
    const out = buildScoreboard({
      shifts: [
        {
          userId: "u1",
          startsAt: at("2026-05-25T09:00:00Z"),
          endsAt: at("2026-05-25T17:00:00Z"),
          locationId: null,
        },
      ],
      events: [],
      approvedWeeks: new Set(),
    });
    const s = out.get("u1")!;
    expect(s.attended).toBe(0);
    expect(s.noShows).toBe(1);
    expect(s.lateCount).toBe(0);
  });

  it("sums unapproved OT only outside shift.endsAt + grace", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"),
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: null,
    };
    // Work continues for 45 min past shift end → 30 min of OT after the 15-min grace.
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: at("2026-05-25T09:00:00Z") },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T17:45:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    const s = out.get("u1")!;
    expect(s.unapprovedOtMs).toBe(30 * 60_000);
    expect(OT_GRACE_MS).toBe(15 * 60_000);
  });

  it("zeroes OT when the covering week has an approved timesheet", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"), // Monday → weekStart 2026-05-25
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: null,
    };
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: at("2026-05-25T09:00:00Z") },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T18:00:00Z") },
      ],
      approvedWeeks: new Set(["u1|2026-05-25"]),
    });
    expect(out.get("u1")!.unapprovedOtMs).toBe(0);
  });

  it("location filter excludes shifts at other locations", () => {
    const out = buildScoreboard({
      shifts: [
        {
          userId: "u1",
          startsAt: at("2026-05-25T09:00:00Z"),
          endsAt: at("2026-05-25T17:00:00Z"),
          locationId: "loc-a",
        },
        {
          userId: "u1",
          startsAt: at("2026-05-26T09:00:00Z"),
          endsAt: at("2026-05-26T17:00:00Z"),
          locationId: "loc-b",
        },
      ],
      events: [],
      approvedWeeks: new Set(),
      locationId: "loc-a",
    });
    const s = out.get("u1")!;
    expect(s.scheduled).toBe(1);
    expect(s.noShows).toBe(1);
  });

  it("caps OT at the next scheduled shift's start (no bleed-into-tomorrow)", () => {
    // Two back-to-back shifts on consecutive days. Worker stays clocked
    // in through both. OT for today's shift should NOT count the work
    // that actually belongs to tomorrow's shift window.
    const shifts = [
      {
        userId: "u1",
        startsAt: at("2026-05-25T09:00:00Z"),
        endsAt: at("2026-05-25T17:00:00Z"),
        locationId: null,
      },
      {
        userId: "u1",
        startsAt: at("2026-05-26T09:00:00Z"),
        endsAt: at("2026-05-26T17:00:00Z"),
        locationId: null,
      },
    ];
    const out = buildScoreboard({
      shifts,
      events: [
        { userId: "u1", eventType: "in", occurredAt: at("2026-05-25T09:00:00Z") },
        // Stayed clocked in straight through to the end of day 2.
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-26T17:00:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    const s = out.get("u1")!;
    // Today's OT window: 17:15 day 1 → 09:00 day 2 = 15h 45m.
    // Tomorrow's OT window: 17:15 day 2 → end of seg (17:00 day 2). Empty
    // (segment ends before its OT cutoff).
    expect(s.unapprovedOtMs).toBe((15 * 60 + 45) * 60_000);
  });

  it("first-in-of-day wins for lateness even after a break_end on the same day", () => {
    const shift = {
      userId: "u1",
      startsAt: at("2026-05-25T09:00:00Z"),
      endsAt: at("2026-05-25T17:00:00Z"),
      locationId: null,
    };
    const out = buildScoreboard({
      shifts: [shift],
      events: [
        { userId: "u1", eventType: "in", occurredAt: at("2026-05-25T09:01:00Z") }, // on time
        { userId: "u1", eventType: "break_start", occurredAt: at("2026-05-25T12:00:00Z") },
        { userId: "u1", eventType: "break_end", occurredAt: at("2026-05-25T13:00:00Z") },
        { userId: "u1", eventType: "out", occurredAt: at("2026-05-25T17:00:00Z") },
      ],
      approvedWeeks: new Set(),
    });
    expect(out.get("u1")!.lateCount).toBe(0);
  });
});
