import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Single source of truth: the workspace-root .env. Loaded explicitly because
// pnpm runs this script with cwd = packages/db/, not the repo root, so
// `dotenv/config`'s default cwd lookup misses it.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../../.env") });

async function main() {
  // Migrations use the session/direct connection (port 5432) for stable DDL.
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DIRECT_URL or DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  const db = drizzle(sql);
  // 1. Drizzle-generated baseline (tables, FKs, indexes, checks). The baseline
  //    itself runs `CREATE SCHEMA "app"`, so we don't pre-create it here.
  await migrate(db, {
    migrationsFolder: "./migrations",
    migrationsSchema: "drizzle",
  });
  console.log("[db] drizzle migrations applied");

  // 2. Hand-written SQL that Drizzle can't model (RLS policies), applied in
  //    filename order. Idempotent (each file uses IF EXISTS / OR REPLACE), so
  //    re-running is safe — there is no separate ledger for these.
  const manualDir = path.resolve(here, "../migrations/manual");
  let files: string[] = [];
  try {
    files = (await readdir(manualDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    // no manual dir → nothing to apply
  }
  for (const file of files) {
    const ddl = await readFile(path.join(manualDir, file), "utf8");
    await sql.unsafe(ddl);
    console.log(`[db] applied manual/${file}`);
  }

  await sql.end();
  console.log("[db] migrations complete");
}

main().catch((err) => {
  console.error("[db] migration failed:", err);
  process.exit(1);
});
