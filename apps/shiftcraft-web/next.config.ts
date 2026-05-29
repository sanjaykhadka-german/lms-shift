import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Pin Turbopack's workspace root to the monorepo root (two levels up from
// apps/shiftcraft-web). Without this, a stray lockfile in a parent dir (e.g.
// ~/package-lock.json) makes Next infer the home directory as root and watch
// the entire user profile — huge memory + file-watcher blowup.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@tracey/ui", "@tracey/auth", "@tracey/db", "@tracey/types"],
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: monorepoRoot,
  },
  experimental: {
    // People > Documents uploads can be up to 5 MiB (bytea in sc_documents).
    // Next's default server-action body limit is 1 MB, which would reject
    // legitimate PDFs. The schema CHECK still hard-caps actual storage.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
