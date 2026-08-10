import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, sep } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
const runtimeHomeGlob = `${homedir().split(sep).join("/")}/**/*`;
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  webpack(config, { dev, isServer }) {
    if (isServer && !dev) {
      // User files are runtime data, never build inputs. Next's entry tracer
      // otherwise expands fs directory reads into a recursive home-directory
      // glob, which fails on protected Windows compatibility junctions.
      for (const plugin of config.plugins ?? []) {
        const tracePlugin = plugin as unknown as {
          constructor?: { name?: string };
          traceIgnores?: string[];
        };
        if (
          tracePlugin.constructor?.name === "TraceEntryPointsPlugin" &&
          Array.isArray(tracePlugin.traceIgnores)
        ) {
          tracePlugin.traceIgnores.push(runtimeHomeGlob);
        }
      }
    }
    return config;
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
