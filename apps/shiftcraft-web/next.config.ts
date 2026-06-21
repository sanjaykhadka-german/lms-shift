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
  // Dev-only. `next dev` blocks _next/* asset loads and server-action calls
  // that arrive with a non-localhost Origin/Host, so opening the app from
  // another device on the LAN (e.g. a kiosk tablet at http://192.168.x.x:4100)
  // renders the HTML but never hydrates — the live clock stays --:--:-- and
  // buttons do nothing. List the dev machine's LAN address(es) here to allow
  // them. The `*` wildcards cover a changing last octet on a typical home/
  // shop subnet; add specific IPs if yours differs. No effect in production.
  allowedDevOrigins: ["192.168.2.78", "192.168.2.*", "192.168.0.*", "192.168.1.*"],
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
