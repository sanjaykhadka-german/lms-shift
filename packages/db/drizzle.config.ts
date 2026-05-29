import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Workspace-root .env (drizzle-kit runs from packages/db/, not repo root).
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

// Migrations run against the Supabase session/direct connection (port 5432).
// Prefer DIRECT_URL; fall back to DATABASE_URL for local dev.
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL is required for drizzle-kit");
}

export default defineConfig({
  dialect: "postgresql",
  // All app + LMS + ShiftCraft tables are Drizzle-owned now.
  schema: [
    "./src/schema.ts",
    "./src/lms-schema.ts",
    "./src/shiftcraft-schema.ts",
  ],
  out: "./migrations",
  // Only manage our own schemas — never touch Supabase reserved schemas
  // (auth, storage, realtime, vault, extensions, graphql).
  schemaFilter: ["app", "public"],
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
