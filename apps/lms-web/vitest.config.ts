import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Four files (cross-schema, per-tenant-provision, per-tenant-rls,
    // tenant-copy) do schema DDL against the same Postgres DB. Concurrent
    // DROP SCHEMA CASCADE / CREATE SCHEMA / ALTER ENABLE RLS hit
    // pg_namespace + pg_class locks that don't isolate by schema name,
    // causing intermittent deadlock detection in CI. singleFork puts all
    // files in one worker process so DDL is serialised.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
