import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tracey/ui", "@tracey/auth", "@tracey/db", "@tracey/types"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
