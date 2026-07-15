import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const appRoot = (() => {
  try {
    return __dirname;
  } catch {
    return process.cwd();
  }
})();

const { version } = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(appRoot, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
