import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

// Workspace-root .env (this script runs from packages/db/, not repo root).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

/**
 * Drops the `app` schema (Tracey tables), the `drizzle` schema (drizzle-kit's
 * migration journal), and every base table in `public` (the LMS + ShiftCraft
 * domain tables) from the configured database.
 *
 * After this runs, `pnpm db:migrate` will re-apply the baseline from scratch.
 *
 * USE WITH CARE — this destroys all data. Intended for a database dedicated to
 * this app (it drops ALL public tables). Idempotent (safe to re-run).
 */
async function main() {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
  }

  // Refuse to run against a production-looking URL unless TRACEY_RESET_FORCE=1.
  // Cheap heuristic: if the host isn't localhost/127.0.0.1 and FORCE isn't
  // set, bail. Stops accidental nukes of Render Postgres.
  const url = new URL(databaseUrl);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (!isLocal && process.env.TRACEY_RESET_FORCE !== "1") {
    throw new Error(
      `Refusing to reset against non-local DATABASE_URL host '${url.hostname}'. ` +
        `Set TRACEY_RESET_FORCE=1 to override (only do this against a known-disposable DB).`,
    );
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  console.log(`[db:reset] dropping schemas on ${url.hostname}/${url.pathname.slice(1)}`);
  await sql`DROP SCHEMA IF EXISTS app CASCADE`;
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  // Drop all base tables in public (LMS + ShiftCraft domain tables).
  await sql.unsafe(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
  await sql.end();
  console.log("[db:reset] done. Run `pnpm db:migrate` next.");
}

main().catch((err) => {
  console.error("[db:reset] failed:", err);
  process.exit(1);
});
