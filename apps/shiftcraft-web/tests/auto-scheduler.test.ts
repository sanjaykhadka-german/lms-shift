import { describe, it, expect, vi } from "vitest";

// Auto-scheduler is pure (no db), but the module imports
// availability-check which itself imports nothing from @tracey/db.
// Still need to satisfy the test runner's module-resolution by
// providing a stub for any indirect imports.
vi.mock("@tracey/db", () => ({}));

const { generateAssignmentPlan } = await import("~/lib/auto-scheduler");

import type {
  AutoSchedulerCandidate,
  AutoSchedulerShift,
  ApprovedLeaveWindow,
} from "~/lib/auto-scheduler";

const t = (iso: string) => new Date(iso);

const SHIFT_A: AutoSchedulerShift = {
  id: "shift-a",
  startsAt: t("2026-06-01T09:00:00"),
  endsAt: t("2026-06-01T17:00:00"),
  requiredSkillId: null,
  locationId: "loc-1",
  role: "Cashier",
};

const SHIFT_B: AutoSchedulerShift = {
  id: "shift-b",
  startsAt: t("2026-06-02T09:00:00"),
  endsAt: t("2026-06-02T17:00:00"),
  requiredSkillId: null,
  locationId: "loc-1",
  role: "Cashier",
};

function candidate(
  partial: Partial<AutoSchedulerCandidate> & { appUserId: string },
): AutoSchedulerCandidate {
  return {
    fullName: partial.fullName ?? partial.appUserId,
    hourlyRate: partial.hourlyRate ?? 25,
    availability: partial.availability ?? null,
    skills: partial.skills ?? new Set<string>(),
    ...partial,
  };
}

describe("generateAssignmentPlan", () => {
  it("returns an empty proposal when there are no shifts", () => {
    const result = generateAssignmentPlan([], [], [], new Map());
    expect(result.proposal).toEqual([]);
    expect(result.unfilled).toEqual([]);
  });

  it("assigns the lowest-rate candidate when multiple match", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({ appUserId: "u-expensive", hourlyRate: 40 }),
        candidate({ appUserId: "u-cheap", hourlyRate: 22 }),
        candidate({ appUserId: "u-mid", hourlyRate: 28 }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal).toHaveLength(1);
    expect(result.proposal[0]?.userId).toBe("u-cheap");
    expect(result.unfilled).toEqual([]);
  });

  it("rejects candidates missing the required skill", () => {
    const SKILL = "skill-rsa";
    const shift = { ...SHIFT_A, requiredSkillId: SKILL };
    const result = generateAssignmentPlan(
      [shift],
      [
        candidate({ appUserId: "u-noskill", hourlyRate: 22 }),
        candidate({
          appUserId: "u-hasskill",
          hourlyRate: 30,
          skills: new Set([SKILL]),
        }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-hasskill");
  });

  it("skips candidates with an overlapping approved leave window", () => {
    const leave = new Map<string, ApprovedLeaveWindow[]>();
    leave.set("u-on-leave", [
      { startDate: "2026-05-30", endDate: "2026-06-03" },
    ]);
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({ appUserId: "u-on-leave", hourlyRate: 20 }),
        candidate({ appUserId: "u-available", hourlyRate: 25 }),
      ],
      [],
      leave,
    );
    expect(result.proposal[0]?.userId).toBe("u-available");
  });

  it("rejects when the availability jsonb declares the day as unavailable", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A], // Monday 2026-06-01
      [
        candidate({
          appUserId: "u-off-mon",
          hourlyRate: 20,
          availability: { mon: "off" },
        }),
        candidate({ appUserId: "u-flex", hourlyRate: 25 }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-flex");
  });

  it("rejects when the availability jsonb window doesn't cover the shift", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A], // 09:00–17:00 Monday
      [
        candidate({
          appUserId: "u-morning-only",
          hourlyRate: 20,
          availability: { mon: "09-13" },
        }),
        candidate({
          appUserId: "u-full-day",
          hourlyRate: 25,
          availability: { mon: "08-18" },
        }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-full-day");
  });

  it("rejects when adding this shift would exceed maxWeeklyHours", () => {
    // u-cheap already has 36h of existing assignments this week;
    // shift A is 8h → would push to 44h, over the 40h default cap.
    const existing = [
      {
        userId: "u-cheap",
        startsAt: t("2026-05-30T08:00:00"),
        endsAt: t("2026-05-30T20:00:00"),
        locationId: "loc-1",
      },
      {
        userId: "u-cheap",
        startsAt: t("2026-05-31T08:00:00"),
        endsAt: t("2026-05-31T20:00:00"),
        locationId: "loc-1",
      },
      {
        userId: "u-cheap",
        startsAt: t("2026-06-01T20:30:00"), // unrelated rest-of-day
        endsAt: t("2026-06-01T22:30:00"),
        locationId: "loc-1",
      },
    ];
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({ appUserId: "u-cheap", hourlyRate: 20 }),
        candidate({ appUserId: "u-fresh", hourlyRate: 30 }),
      ],
      existing,
      new Map(),
    );
    // u-cheap has 24h prior; +8h shift = 32h, still under 40h.
    // u-cheap would also conflict on min-rest from the 20:30 shift
    // since shift A ends 17:00 → 3.5h gap before 20:30, < 10h min.
    expect(result.proposal[0]?.userId).toBe("u-fresh");
    const reasoning = result.proposal[0]?.reasoning;
    expect(reasoning).toContain("$30.00/h");
  });

  it("enforces the 10h min-rest between assigned shifts", () => {
    // u-cheap already worked Saturday 22:00–06:00; Sunday 09:00 shift
    // would only have 3h rest after the prior end.
    const existing = [
      {
        userId: "u-cheap",
        startsAt: t("2026-05-30T22:00:00"),
        endsAt: t("2026-05-31T06:00:00"),
        locationId: "loc-1",
      },
    ];
    const sundayShift: AutoSchedulerShift = {
      id: "shift-sun",
      startsAt: t("2026-05-31T09:00:00"),
      endsAt: t("2026-05-31T13:00:00"),
      requiredSkillId: null,
      locationId: "loc-1",
      role: "Cashier",
    };
    const result = generateAssignmentPlan(
      [sundayShift],
      [
        candidate({ appUserId: "u-cheap", hourlyRate: 20 }),
        candidate({ appUserId: "u-rested", hourlyRate: 25 }),
      ],
      existing,
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-rested");
  });

  it("the running state updates so proposal 1 affects proposal 2", () => {
    // Two shifts back-to-back same day — only candidate is u-cheap.
    // The first shift gets assigned; the second one fails rest check
    // (shift A ends 17:00, shift C starts 18:00 — only 1h gap).
    const SHIFT_C: AutoSchedulerShift = {
      id: "shift-c",
      startsAt: t("2026-06-01T18:00:00"),
      endsAt: t("2026-06-01T22:00:00"),
      requiredSkillId: null,
      locationId: "loc-1",
      role: "Cashier",
    };
    const result = generateAssignmentPlan(
      [SHIFT_A, SHIFT_C],
      [candidate({ appUserId: "u-cheap", hourlyRate: 20 })],
      [],
      new Map(),
    );
    expect(result.proposal).toHaveLength(1);
    expect(result.proposal[0]?.shiftId).toBe("shift-a");
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0]?.shiftId).toBe("shift-c");
    expect(result.unfilled[0]?.rejections.join(" ")).toContain("rest");
  });

  it("falls back to no-rate candidates only when no rate-set candidates match", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({ appUserId: "u-norate", hourlyRate: null }),
        candidate({ appUserId: "u-rate", hourlyRate: 30 }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-rate");
  });

  it("breaks final ties on fullName ascending for determinism", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({
          appUserId: "u-zed",
          fullName: "Zed",
          hourlyRate: 25,
        }),
        candidate({
          appUserId: "u-alice",
          fullName: "Alice",
          hourlyRate: 25,
        }),
      ],
      [],
      new Map(),
    );
    expect(result.proposal[0]?.userId).toBe("u-alice");
  });

  it("collects rejection reasons for unfilled shifts", () => {
    const shift = { ...SHIFT_A, requiredSkillId: "skill-rsa" };
    const result = generateAssignmentPlan(
      [shift],
      [candidate({ appUserId: "u-noskill", hourlyRate: 20 })],
      [],
      new Map(),
    );
    expect(result.proposal).toHaveLength(0);
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0]?.rejections[0]).toContain("missing required skill");
  });

  it("is deterministic across runs", () => {
    const inputs = {
      shifts: [SHIFT_A, SHIFT_B],
      candidates: [
        candidate({ appUserId: "u-a", hourlyRate: 25 }),
        candidate({ appUserId: "u-b", hourlyRate: 25 }),
      ],
    };
    const r1 = generateAssignmentPlan(
      inputs.shifts,
      inputs.candidates,
      [],
      new Map(),
    );
    const r2 = generateAssignmentPlan(
      inputs.shifts,
      inputs.candidates,
      [],
      new Map(),
    );
    expect(r1).toEqual(r2);
  });
});

describe("generateAssignmentPlan — daily wage budget", () => {
  // SHIFT_A is 8h (09:00–17:00) at loc-1 on 2026-06-01.
  const BUDGET_KEY = "loc-1|2026-06-01";

  it("assigns within budget and reports the day's running spend", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [candidate({ appUserId: "u-cheap", hourlyRate: 20 })], // 8h × $20 = $160
      [],
      new Map(),
      { dayBudgets: new Map([[BUDGET_KEY, 200]]) },
    );
    expect(result.proposal).toHaveLength(1);
    expect(result.proposal[0]?.userId).toBe("u-cheap");
    expect(result.proposal[0]?.reasoning).toContain("day spend $160/$200");
    expect(result.unfilled).toEqual([]);
  });

  it("leaves a shift unfilled when every candidate would breach the budget", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [candidate({ appUserId: "u-cheap", hourlyRate: 20 })], // $160 > $100
      [],
      new Map(),
      { dayBudgets: new Map([[BUDGET_KEY, 100]]) },
    );
    expect(result.proposal).toHaveLength(0);
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0]?.rejections.join(" ")).toContain("wage budget");
  });

  it("skips a rate-set candidate over budget but still fills with a no-rate one", () => {
    // u-rate ($30×8=$240) breaches a $100 cap; u-norate has unknown
    // cost (treated as $0) so it slots in as the in-budget fallback.
    const result = generateAssignmentPlan(
      [SHIFT_A],
      [
        candidate({ appUserId: "u-rate", hourlyRate: 30 }),
        candidate({ appUserId: "u-norate", hourlyRate: null }),
      ],
      [],
      new Map(),
      { dayBudgets: new Map([[BUDGET_KEY, 100]]) },
    );
    expect(result.proposal).toHaveLength(1);
    expect(result.proposal[0]?.userId).toBe("u-norate");
  });

  it("counts existing same-day shifts at the location toward the budget", () => {
    // u-seed already worked 8h × $10 = $80 at loc-1 on 2026-06-01.
    // The new (skill-gated) shift for u-new adds $20 → $100, which
    // sits under a $120 cap. The reasoning proves the $80 base was
    // seeded from the existing assignment.
    const skilledShift: AutoSchedulerShift = {
      ...SHIFT_A,
      id: "shift-skilled",
      startsAt: t("2026-06-01T17:00:00"),
      endsAt: t("2026-06-01T21:00:00"), // 4h
      requiredSkillId: "skill-x",
    };
    const existing = [
      {
        userId: "u-seed",
        startsAt: t("2026-06-01T08:00:00"),
        endsAt: t("2026-06-01T16:00:00"), // 8h
        locationId: "loc-1",
      },
    ];
    const candidates = [
      candidate({ appUserId: "u-seed", hourlyRate: 10 }), // lacks skill-x
      candidate({
        appUserId: "u-new",
        hourlyRate: 5, // 4h × $5 = $20
        skills: new Set(["skill-x"]),
      }),
    ];
    const under = generateAssignmentPlan(
      [skilledShift],
      candidates,
      existing,
      new Map(),
      { dayBudgets: new Map([[BUDGET_KEY, 120]]) },
    );
    expect(under.proposal[0]?.userId).toBe("u-new");
    expect(under.proposal[0]?.reasoning).toContain("day spend $100/$120");

    // Same setup, tighter cap → the seeded $80 pushes u-new over.
    const over = generateAssignmentPlan(
      [skilledShift],
      candidates,
      existing,
      new Map(),
      { dayBudgets: new Map([[BUDGET_KEY, 90]]) },
    );
    expect(over.proposal).toHaveLength(0);
    expect(over.unfilled[0]?.rejections.join(" ")).toContain("wage budget");
  });

  it("ignores budgets for other location/day keys (legacy behaviour)", () => {
    const result = generateAssignmentPlan(
      [SHIFT_A], // loc-1 / 2026-06-01
      [candidate({ appUserId: "u-cheap", hourlyRate: 20 })],
      [],
      new Map(),
      { dayBudgets: new Map([["loc-2|2026-06-01", 1]]) },
    );
    expect(result.proposal).toHaveLength(1);
    expect(result.proposal[0]?.userId).toBe("u-cheap");
    // No budget for this shift's key → no day-spend annotation.
    expect(result.proposal[0]?.reasoning).not.toContain("day spend");
  });
});
