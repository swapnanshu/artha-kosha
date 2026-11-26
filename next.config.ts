import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server Actions are public HTTP endpoints; the body cap keeps a stray
    // large POST from being an easy way to burn a function's memory.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
