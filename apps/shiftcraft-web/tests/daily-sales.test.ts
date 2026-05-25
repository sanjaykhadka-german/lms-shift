import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", () => ({
  forTenant: () => ({ run: async () => [] }),
  scDailySales: {},
  scLocations: {},
}));

const { aggregateSalesByDate, sumGrossSales } = await import(
  "~/lib/daily-sales"
);

interface MockRow {
  id: string;
  locationId: string;
  businessDate: string;
  grossSales: string;
  notes: string | null;
}

const row = (
  date: string,
  locationId: string,
  gross: number | string,
): MockRow => ({
  id: `${date}-${locationId}`,
  locationId,
  businessDate: date,
  grossSales: typeof gross === "string" ? gross : gross.toFixed(2),
  notes: null,
});

describe("sumGrossSales", () => {
  it("returns 0 for an empty array", () => {
    expect(sumGrossSales([])).toBe(0);
  });

  it("sums numeric string amounts", () => {
    expect(
      sumGrossSales([
        row("2026-05-25", "loc-1", 1234.5),
        row("2026-05-25", "loc-2", 765.5),
      ]),
    ).toBe(2000);
  });

  it("skips rows with non-finite gross", () => {
    expect(
      sumGrossSales([
        row("2026-05-25", "loc-1", "abc"),
        row("2026-05-25", "loc-2", 500),
      ]),
    ).toBe(500);
  });
});

describe("aggregateSalesByDate", () => {
  it("keys by ISO date and sums across locations", () => {
    const map = aggregateSalesByDate([
      row("2026-05-25", "loc-1", 1000),
      row("2026-05-25", "loc-2", 500),
      row("2026-05-26", "loc-1", 800),
    ]);
    expect(map.size).toBe(2);
    expect(map.get("2026-05-25")?.total).toBe(1500);
    expect(map.get("2026-05-26")?.total).toBe(800);
  });

  it("preserves per-location breakdowns inside each date entry", () => {
    const map = aggregateSalesByDate([
      row("2026-05-25", "loc-1", 1000),
      row("2026-05-25", "loc-2", 500),
    ]);
    const day = map.get("2026-05-25");
    expect(day?.byLocation.get("loc-1")).toBe(1000);
    expect(day?.byLocation.get("loc-2")).toBe(500);
  });

  it("returns an empty map for no rows", () => {
    expect(aggregateSalesByDate([]).size).toBe(0);
  });

  it("ignores rows with non-finite gross", () => {
    const map = aggregateSalesByDate([
      row("2026-05-25", "loc-1", "NaN"),
      row("2026-05-25", "loc-2", 500),
    ]);
    expect(map.get("2026-05-25")?.total).toBe(500);
  });
});
