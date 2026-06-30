import { describe, it, expect } from "vitest";
import type { XeroTimesheetInput } from "~/lib/payroll/xero";
import { deriveXeroIdempotencyKey } from "~/lib/payroll/idempotency";

// The helper is pure and has no runtime dependency on the xero-node SDK
// (it only imports XeroTimesheetInput as a type), so it imports cleanly here.

const TENANT = "add6df90-1111-2222-3333-444455556666";
const WEEK = "2026-06-15";

function ts(unitsByDay: number[]): XeroTimesheetInput[] {
  return [
    {
      xeroEmployeeId: "xe-1",
      startDate: WEEK,
      endDate: "2026-06-21",
      lines: [{ earningsRateId: "rate-ordinary", unitsByDay }],
    },
  ];
}

describe("deriveXeroIdempotencyKey", () => {
  it("returns the same key for an unchanged payload (no double-pay on re-click)", () => {
    const payload = ts([8, 8, 8, 8, 8, 0, 0]);
    const a = deriveXeroIdempotencyKey(TENANT, WEEK, payload);
    const b = deriveXeroIdempotencyKey(TENANT, WEEK, ts([8, 8, 8, 8, 8, 0, 0]));
    expect(a).toBe(b);
  });

  it("returns a different key when hours are corrected (re-export goes through)", () => {
    const original = deriveXeroIdempotencyKey(TENANT, WEEK, ts([8, 8, 8, 8, 8, 0, 0]));
    const corrected = deriveXeroIdempotencyKey(TENANT, WEEK, ts([8, 8, 8, 8, 7.5, 0, 0]));
    expect(corrected).not.toBe(original);
  });

  it("varies by week and tenant", () => {
    const base = deriveXeroIdempotencyKey(TENANT, WEEK, ts([8]));
    const otherWeek = deriveXeroIdempotencyKey(TENANT, "2026-06-22", ts([8]));
    const otherTenant = deriveXeroIdempotencyKey(
      "ffffffff-0000-0000-0000-000000000000",
      WEEK,
      ts([8]),
    );
    expect(otherWeek).not.toBe(base);
    expect(otherTenant).not.toBe(base);
  });

  it("keeps the stable sc2-{tenant8}-{week}-{hash} shape", () => {
    const key = deriveXeroIdempotencyKey(TENANT, WEEK, ts([8]));
    expect(key).toMatch(/^sc2-add6df90-2026-06-15-[0-9a-f]{12}$/);
  });

  it("attempt 0 reproduces the un-salted content key (default unchanged)", () => {
    const payload = ts([8, 8, 8, 8, 8, 0, 0]);
    expect(deriveXeroIdempotencyKey(TENANT, WEEK, payload, 0)).toBe(
      deriveXeroIdempotencyKey(TENANT, WEEK, payload),
    );
  });

  it("a salted attempt mints a fresh key to escape a stale Xero cache entry", () => {
    const payload = ts([8, 8, 8, 8, 8, 0, 0]);
    const base = deriveXeroIdempotencyKey(TENANT, WEEK, payload, 0);
    const salt1 = deriveXeroIdempotencyKey(TENANT, WEEK, payload, 1);
    const salt2 = deriveXeroIdempotencyKey(TENANT, WEEK, payload, 2);
    expect(salt1).not.toBe(base);
    expect(salt2).not.toBe(base);
    expect(salt2).not.toBe(salt1);
    // Still the same recognisable shape so logs/telemetry stay parseable.
    expect(salt1).toMatch(/^sc2-add6df90-2026-06-15-[0-9a-f]{12}$/);
  });

  it("is independent of employee order (no flapping on unordered DB rows)", () => {
    const a = {
      xeroEmployeeId: "aaa",
      startDate: WEEK,
      endDate: "2026-06-21",
      lines: [{ earningsRateId: "r", unitsByDay: [8, 0, 0, 0, 0, 0, 0] }],
    };
    const b = {
      xeroEmployeeId: "bbb",
      startDate: WEEK,
      endDate: "2026-06-21",
      lines: [{ earningsRateId: "r", unitsByDay: [0, 8, 0, 0, 0, 0, 0] }],
    };
    const forward = deriveXeroIdempotencyKey(TENANT, WEEK, [a, b]);
    const reversed = deriveXeroIdempotencyKey(TENANT, WEEK, [b, a]);
    expect(forward).toBe(reversed);
  });
});
