import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  // A second dev server on the same checkout fights the first one over
  // .next/dev. Pointing it at its own build directory is what makes a
  // throwaway instance possible — e.g. an unauthenticated one to look at the
  // UI with, while the real server keeps running:
  //   PI_WEB_PASSWORD= PI_WEB_DIST_DIR=.next-preview npm run dev -- -p 30143
  distDir: process.env.PI_WEB_DIST_DIR || ".next",
  serverExternalPackages: [
    "undici",
    "node-pty",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  experimental: {
    // ModelsConfig imports 31 provider icons by deep path already, but the
    // package barrel still gets pulled in transitively; this keeps the import
    // graph to the icons actually referenced.
    optimizePackageImports: ["@lobehub/icons"],
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
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
