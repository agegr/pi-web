import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
const { version: piVersion } = JSON.parse(readFileSync(join(__dirname, "node_modules/@mariozechner/pi-coding-agent/package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  serverExternalPackages: ["@mariozechner/pi-coding-agent", "@mariozechner/pi-ai"],
  allowedDevOrigins: ['192.168.*.*'],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
