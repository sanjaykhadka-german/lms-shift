import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tracey/ui", "@tracey/auth", "@tracey/db", "@tracey/types"],
  poweredByHeader: false,
  reactStrictMode: true,
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
