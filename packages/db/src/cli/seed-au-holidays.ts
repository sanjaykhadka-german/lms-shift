// AU public-holiday seeder (AUDIT.md Phase 2 #3a).
//
// Reads packages/db/fixtures/au-holidays-2026-2027.json and upserts each
// row into public.au_public_holidays. The unique index on
// (region, observed_on, name) is the ON CONFLICT target — re-running this
// script after editing the fixture refreshes name/is_national/source for
// existing rows without duplicating. Adding new years is just editing
// the JSON and re-running.
//
// Usage (local):
//   pnpm --filter @tracey/db seed-au-holidays
//
// Usage (prod, against Render lms-db):
//   DATABASE_URL='postgres://…?sslmode=require' \
//     pnpm --filter @tracey/db seed-au-holidays
//
// Pre-req: packages/db/migrations/manual/0010_au_public_holidays.sql
// must have been applied (creates the table + indexes).

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
loadEnv({ path: path.resolve(repoRoot, ".env") });

interface HolidayRow {
  region: string;
  observed_on: string;
  name: string;
  is_national: boolean;
  source: string | null;
}

interface Fixture {
  _meta?: unknown;
  holidays: HolidayRow[];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const fixturePath = path.resolve(
    here,
    "..",
    "..",
    "fixtures",
    "au-holidays-2026-2027.json",
  );
  const raw = fs.readFileSync(fixturePath, "utf-8");
  const fixture = JSON.parse(raw) as Fixture;
  if (!Array.isArray(fixture.holidays)) {
    console.error("Fixture missing `holidays` array");
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(client);

  // Upsert one row at a time. The fixture is ~80 rows — tiny enough that
  // batching isn't worth the complexity, and per-row is easier to debug.
  let inserted = 0;
  let updated = 0;
  for (const h of fixture.holidays) {
    const result = await db.execute(sql`
      INSERT INTO public.au_public_holidays
        (region, observed_on, name, is_national, source)
      VALUES
        (${h.region}, ${h.observed_on}, ${h.name}, ${h.is_national}, ${h.source})
      ON CONFLICT (region, observed_on, name) DO UPDATE
        SET is_national = EXCLUDED.is_national,
            source      = EXCLUDED.source
      RETURNING (xmax = 0) AS was_inserted
    `);
    // postgres-js returns the rows as an array of objects.
    const rows = result as unknown as Array<{ was_inserted: boolean }>;
    if (rows[0]?.was_inserted) inserted += 1;
    else updated += 1;
  }

  console.log(
    `Seeded au_public_holidays: ${inserted} inserted, ${updated} updated (${fixture.holidays.length} total).`,
  );
  await client.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
