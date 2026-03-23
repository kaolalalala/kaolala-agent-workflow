import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-pty"],
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
