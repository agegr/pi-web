import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // Enable standalone output for Docker builds (set NEXT_OUTPUT=standalone)
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  allowedDevOrigins: ['192.168.*.*', '*.loca.lt'],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
