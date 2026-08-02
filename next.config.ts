import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as {
  version: string;
};
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch {
  /* package not found, use default */
}

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
  async headers() {
    // The long-lived `immutable` cache for /_next/static MUST only apply in
    // production. Under `next dev` (Turbopack) those chunks are regenerated on
    // every recompile; serving them with `immutable` makes the browser pin a
    // stale dev chunk forever, desyncing the module registry and triggering the
    // "module factory is not available" runtime error on a clean compile.
    const isProd = process.env.NODE_ENV === "production";
    const result: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }> = [];

    if (isProd) {
      // Long-lived cache for static assets (fonts, CSS, JS chunks with content hash)
      result.push({
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      });
      // Medium-lived cache for public assets
      result.push({
        source: "/:file(favicon.ico|robots.txt)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      });
    }

    // No-cache for the main HTML page (dev + prod)
    result.push({
      source: "/",
      headers: [{ key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" }],
    });

    // PWA service worker + manifest (from upstream v0.8.x)
    result.push({
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    });
    result.push({
      source: "/manifest.webmanifest",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    });

    // Security headers
    result.push({
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    });

    return result;
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
