import { beforeEach, describe, expect, it, vi } from "vitest";

// AUDIT.md Phase 2 #3a — coverage for the helper API + the
// setHolidayRegionAction. The au_public_holidays table is queried via
// raw SQL through @tracey/db's `db` export; the mock harness intercepts
// `db.execute` and returns seeded rows so tests don't need a live pg.

const state = {
  // Rows backing public.au_public_holidays — the mock filters by region
  // + date range to mimic the real SQL.
  holidays: [] as Array<{
    region: string;
    observed_on: string; // ISO YYYY-MM-DD
    name: string;
    is_national: boolean;
  }>,
  // sc_tenant_config keyed by traceyTenantId — null/missing means the
  // helper falls back to "national".
  config: new Map<
    string,
    { holidayRegion: string; updatedByUserId: string | null }
  >(),
  audits: [] as Array<{
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown> | null;
  }>,
  membership: {
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  } as { tenant: { id: string; name: string }; role: string } | null,
  user: {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    image: null,
  } as
    | { id: string; email: string; name: string; image: null }
    | null,
};

function resetState() {
  state.holidays = [];
  state.config.clear();
  state.audits = [];
  state.membership = {
    tenant: { id: "tenant-A", name: "Tenant A" },
    role: "admin",
  };
  state.user = {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    image: null,
  };
}

vi.mock("@tracey/db", () => {
  const scTenantConfig = {
    __table: "scTenantConfig",
    traceyTenantId: { __field: "traceyTenantId" },
    holidayRegion: { __field: "holidayRegion" },
    updatedByUserId: { __field: "updatedByUserId" },
    updatedAt: { __field: "updatedAt" },
  };
  return {
    scTenantConfig,
    db: {
      // Helper queries public.au_public_holidays via db.execute. The mock
      // extracts the regions array + date bounds by walking the
      // drizzle-sql template's `values` array; with no real serializer in
      // play, drizzle ships its own opaque object — but we don't need it.
      // We instead leverage that `getHolidaysForTenant` already resolved
      // the region (via the tx.select below) before calling execute, and
      // it always asks for the SAME `[national, region]` list. So we read
      // `state.config` and `state.lastRangeProbe` to know what to return.
      //
      // To keep things simple, we replay the regions/bounds via a side
      // channel that the helper passes when it builds the sql.
      async execute(query: { strings?: ReadonlyArray<string>; queryChunks?: unknown[] }) {
        // Drizzle's sql template stores the original SQL + params; the
        // shape varies across versions. Easiest path: scan the raw text
        // for region/observed_on patterns and read the params off the
        // `queryChunks`. Mock instead reads the helper's bound state
        // (set by the spy below) for filter criteria.
        const spec = lastQuerySpec;
        if (!spec) return [];
        const matches = state.holidays.filter(
          (h) =>
            spec.regions.includes(h.region) &&
            h.observed_on >= spec.from &&
            h.observed_on <= spec.to,
        );
        matches.sort((a, b) => a.observed_on.localeCompare(b.observed_on));
        return matches;
      },
    },
    forTenant: (tenantId: string) => ({
      tenantId,
      async run(fn: (tx: unknown) => Promise<unknown>) {
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                async limit() {
                  const cfg = state.config.get(tenantId);
                  return cfg ? [{ region: cfg.holidayRegion }] : [];
                },
              }),
            }),
          }),
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              onConflictDoUpdate: async (spec: {
                set: Record<string, unknown>;
              }) => {
                // UPSERT: insert if no existing row else apply `set` patch.
                const existing = state.config.get(tenantId);
                if (existing) {
                  state.config.set(tenantId, {
                    holidayRegion:
                      (spec.set.holidayRegion as string) ?? existing.holidayRegion,
                    updatedByUserId:
                      (spec.set.updatedByUserId as string | null) ??
                      existing.updatedByUserId,
                  });
                } else {
                  state.config.set(tenantId, {
                    holidayRegion: values.holidayRegion as string,
                    updatedByUserId:
                      (values.updatedByUserId as string | null) ?? null,
                  });
                }
                return [];
              },
            }),
          }),
        };
        return fn(tx);
      },
    }),
  };
});

// Side channel: the helper's `getHolidaysForTenant` resolves region +
// range, then calls db.execute. We patch `lib/holidays.ts` to also set
// `lastQuerySpec` so the mock execute() above knows what to filter on.
// Implemented by re-exporting a thin instrumentation around the helper.
let lastQuerySpec: { regions: string[]; from: string; to: string } | null = null;

vi.mock("~/lib/auth/current", () => ({
  currentMembership: vi.fn(async () => state.membership),
  currentUser: vi.fn(async () => state.user),
}));

vi.mock("~/lib/audit", () => ({
  logAuditEvent: vi.fn(async (input) => {
    state.audits.push(input);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Patch drizzle's `sql` tag so we can sniff bind parameters: the helper
// builds its query as the outer template + a sql.join(regions). Each
// inner `sql\`${r}\`` call also fires the proxy — we accumulate ALL
// primitive params from any sub-template into `accumulatedParams`, and
// when the OUTER call (whose strings mention "public.au_public_holidays")
// fires, we have everything in order: the region values (from inner
// templates) followed by fromISO + toISO (the outer template's own
// params). Split by ISO-date regex to recover the structure.
let accumulatedParams: unknown[] = [];
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  return {
    ...actual,
    sql: new Proxy(actual.sql as object, {
      apply(target, thisArg, args) {
        const strings = args[0] as TemplateStringsArray | undefined;
        const params = args.slice(1) as unknown[];
        // Collect primitive params only; SQL fragments (objects) are
        // composed-of params we've already seen via the inner template
        // invocations.
        for (const p of params) {
          if (p == null || typeof p === "object") continue;
          accumulatedParams.push(p);
        }
        if (
          strings?.some?.((s: string) =>
            String(s).includes("public.au_public_holidays"),
          )
        ) {
          const dates: string[] = [];
          const regions: string[] = [];
          for (const p of accumulatedParams) {
            if (typeof p === "string" && ISO_DATE.test(p)) dates.push(p);
            else if (typeof p === "string") regions.push(p);
          }
          lastQuerySpec = {
            regions,
            from: dates[0] ?? "",
            to: dates[1] ?? "",
          };
          accumulatedParams = [];
        }
        return Reflect.apply(target as never, thisArg, args);
      },
    }),
  };
});

async function load() {
  return {
    holidays: await import("../lib/holidays"),
    actions: await import("../app/app/admin/settings/actions"),
  };
}

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.append(k, v);
  return f;
}

beforeEach(() => {
  resetState();
  lastQuerySpec = null;
  accumulatedParams = [];
  vi.clearAllMocks();
});

describe("getHolidaysForTenant", () => {
  it("returns only national rows when the tenant region is national", async () => {
    state.holidays = [
      { region: "national", observed_on: "2026-01-01", name: "New Year's Day", is_national: true },
      { region: "national", observed_on: "2026-04-25", name: "ANZAC Day", is_national: true },
      { region: "NSW", observed_on: "2026-06-08", name: "King's Birthday", is_national: false },
    ];
    state.config.set("tenant-A", { holidayRegion: "national", updatedByUserId: null });

    const { holidays } = await load();
    const rows = await holidays.getHolidaysForTenant(
      "tenant-A",
      "2026-01-01",
      "2026-12-31",
    );

    expect(rows.map((r) => r.name)).toEqual(["New Year's Day", "ANZAC Day"]);
    expect(rows.every((r) => r.region === "national")).toBe(true);
  });

  it("returns national + state rows when the tenant region is a state", async () => {
    state.holidays = [
      { region: "national", observed_on: "2026-01-01", name: "New Year's Day", is_national: true },
      { region: "NSW", observed_on: "2026-06-08", name: "King's Birthday", is_national: false },
      { region: "VIC", observed_on: "2026-11-03", name: "Melbourne Cup Day", is_national: false },
    ];
    state.config.set("tenant-A", { holidayRegion: "NSW", updatedByUserId: null });

    const { holidays } = await load();
    const rows = await holidays.getHolidaysForTenant(
      "tenant-A",
      "2026-01-01",
      "2026-12-31",
    );

    expect(rows.map((r) => r.name).sort()).toEqual(
      ["King's Birthday", "New Year's Day"].sort(),
    );
    // VIC row absent — not the tenant's region.
    expect(rows.find((r) => r.name === "Melbourne Cup Day")).toBeUndefined();
  });

  it("respects the [from, to] date range", async () => {
    state.holidays = [
      { region: "national", observed_on: "2026-01-01", name: "New Year's Day", is_national: true },
      { region: "national", observed_on: "2026-04-03", name: "Good Friday", is_national: true },
      { region: "national", observed_on: "2026-12-25", name: "Christmas Day", is_national: true },
    ];
    state.config.set("tenant-A", { holidayRegion: "national", updatedByUserId: null });

    const { holidays } = await load();
    const rows = await holidays.getHolidaysForTenant(
      "tenant-A",
      "2026-04-01",
      "2026-04-30",
    );

    expect(rows.map((r) => r.name)).toEqual(["Good Friday"]);
  });

  it("defaults to 'national' when no sc_tenant_config row exists yet", async () => {
    state.holidays = [
      { region: "national", observed_on: "2026-01-01", name: "New Year's Day", is_national: true },
      { region: "QLD", observed_on: "2026-05-04", name: "Labour Day", is_national: false },
    ];
    // Note: state.config is empty — no row for tenant-A.

    const { holidays } = await load();
    const rows = await holidays.getHolidaysForTenant(
      "tenant-A",
      "2026-01-01",
      "2026-12-31",
    );

    expect(rows.map((r) => r.name)).toEqual(["New Year's Day"]);
  });
});

describe("isPublicHoliday", () => {
  it("returns true for a date that matches a holiday row", async () => {
    const { holidays } = await load();
    const rows = [
      { region: "national" as const, date: "2026-12-25", name: "Christmas Day", isNational: true },
    ];
    expect(holidays.isPublicHoliday("2026-12-25", rows)).toBe(true);
  });

  it("returns false for a date that doesn't match", async () => {
    const { holidays } = await load();
    const rows = [
      { region: "national" as const, date: "2026-12-25", name: "Christmas Day", isNational: true },
    ];
    expect(holidays.isPublicHoliday("2026-12-24", rows)).toBe(false);
  });

  it("returns false for an empty holidays list", async () => {
    const { holidays } = await load();
    expect(holidays.isPublicHoliday("2026-12-25", [])).toBe(false);
  });
});

describe("setHolidayRegionAction", () => {
  it("rejects when the viewer is not a Manager+", async () => {
    state.membership = {
      tenant: { id: "tenant-A", name: "Tenant A" },
      role: "member",
    };
    const { actions } = await load();
    const result = await actions.setHolidayRegionAction(
      { status: "idle" },
      fd({ region: "NSW" }),
    );
    expect(result.status).toBe("error");
    expect(state.config.size).toBe(0);
    expect(state.audits).toHaveLength(0);
  });

  it("rejects an unknown region via Zod", async () => {
    const { actions } = await load();
    const result = await actions.setHolidayRegionAction(
      { status: "idle" },
      fd({ region: "Mars" }),
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.region).toBeTruthy();
    }
    expect(state.config.size).toBe(0);
  });

  it("UPSERTs the config row and writes an audit with from/to", async () => {
    state.config.set("tenant-A", { holidayRegion: "national", updatedByUserId: null });
    const { actions } = await load();
    const result = await actions.setHolidayRegionAction(
      { status: "idle" },
      fd({ region: "NSW" }),
    );
    expect(result.status).toBe("ok");
    expect(state.config.get("tenant-A")).toEqual({
      holidayRegion: "NSW",
      updatedByUserId: "user-1",
    });
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.tenant.holiday_region_changed",
    );
    expect(audit).toBeDefined();
    expect(audit!.details).toMatchObject({ from: "national", to: "NSW" });
  });

  it("creates the config row on first save when none existed", async () => {
    const { actions } = await load();
    const result = await actions.setHolidayRegionAction(
      { status: "idle" },
      fd({ region: "VIC" }),
    );
    expect(result.status).toBe("ok");
    expect(state.config.get("tenant-A")).toMatchObject({ holidayRegion: "VIC" });
    const audit = state.audits.find(
      (a) => a.action === "shiftcraft.tenant.holiday_region_changed",
    );
    expect(audit!.details).toMatchObject({ from: "national", to: "VIC" });
  });

  it("skips the audit when the region is unchanged", async () => {
    state.config.set("tenant-A", { holidayRegion: "NSW", updatedByUserId: "user-old" });
    const { actions } = await load();
    const result = await actions.setHolidayRegionAction(
      { status: "idle" },
      fd({ region: "NSW" }),
    );
    expect(result.status).toBe("ok");
    expect(state.audits).toHaveLength(0);
    // Config row untouched.
    expect(state.config.get("tenant-A")!.updatedByUserId).toBe("user-old");
  });
});
