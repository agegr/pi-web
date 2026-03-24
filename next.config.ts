import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai"],
  allowedDevOrigins: ['192.168.*.*'],
};

export default nextConfig;
