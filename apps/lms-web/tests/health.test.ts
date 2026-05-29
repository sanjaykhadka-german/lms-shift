import { describe, it, expect, vi } from "vitest";

vi.mock("@tracey/db", async () => await import("./fakes/db"));
vi.mock("drizzle-orm", async () => {
  const fake = await import("./fakes/db");
  return { eq: fake.eq, isNotNull: fake.isNotNull, sql: fake.sql };
});

import { GET } from "../app/api/health/route";
import { db } from "./fakes/db";

describe("GET /api/health", () => {
  it("returns ok when the db responds", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ ok: 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body).toEqual({ ok: true, db: "up" });
  });

  it("returns 503 when the db ping rejects", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body).toEqual({ ok: false, db: "down" });
  });
});
