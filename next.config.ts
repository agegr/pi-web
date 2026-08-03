import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// Optional sub-path deployment, e.g. PI_WEB_BASE_PATH=/dev serves the app at
// https://host/dev/. Empty string = root deployment.
//
// Safety: a production build must never accidentally inherit the dev server's
// basePath (builds spawned from the dev process env do). If PI_WEB_BASE_PATH
// is set during a production build, it is ignored unless the operator
// explicitly opts in with PI_WEB_BUILD_BASEPATH=1.
const envBasePath = (process.env.PI_WEB_BASE_PATH ?? "").replace(/\/+$/, "");
const isProdBuild = process.env.NODE_ENV === "production" && !process.env.PI_WEB_DEV_DIST;
const allowProdBasePath = process.env.PI_WEB_BUILD_BASEPATH === "1";
const basePath =
  isProdBuild && envBasePath && !allowProdBasePath
    ? (console.warn(
        `[pi-web] Ignoring PI_WEB_BASE_PATH="${envBasePath}" for the production build (set PI_WEB_BUILD_BASEPATH=1 to allow it).`,
      ),
      "")
    : envBasePath;

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
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
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
