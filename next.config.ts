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
  // Serve HTML and static responses UNCOMPRESSED. Self-hosted deployments
  // sit behind an edge reverse proxy (Caddy in our deploy) that compresses
  // on the way out, and LAN deployments don't need server-side gzip — the
  // browser negotiates its own content-encoding in every other setup.
  // (This setting was originally turned off to work around a since-removed
  // mobile shell's HTML proxy, pi#40; it stays off because re-enabling would
  // change deployed behavior for no measured gain — recorded as that
  // decision.)
  compress: false,
  experimental: {
    // proxy.ts matches /api/:path*, and Next buffers the request body whenever
    // a proxy is present, capped at 10 MB by default. The upload route accepts
    // up to 100 MB per request, so raise the buffer above that or large uploads
    // are truncated and fail with "Failed to parse body as FormData."
    proxyClientMaxBodySize: "128mb",
  },
  // next/image is only used for the static logo, so the /_next/image optimizer
  // (and its sharp/libheif attack surface, see GHSA-2xp9-vwfh-vxw4) is not needed.
  images: { unoptimized: true },
  serverExternalPackages: [
    "node-pty",
    "undici",
    "web-push",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // Next 16 blocks cross-origin access to dev resources by default. Allow the
  // loopback and the RFC1918 LAN ranges so the dev server stays reachable
  // from other machines on the same LAN.
  allowedDevOrigins: [
    "127.0.0.1",
    "10.*.*.*",
    // 172.16.0.0/12
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
    "192.168.*.*",
  ],
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
      {
        // Digital Asset Links for the Android TWA shell (pi#40). Must stay
        // reachable WITHOUT the web-password gate — the browser's TWA
        // verification fetches it unauthenticated. proxy.ts's matcher
        // (["/", "/login", "/api/:path*"]) never matches this path, so no
        // proxy change is needed. Regenerate per APK re-sign with
        // mobile-twa/scripts/assetlinks.sh; max-age=0 so Chrome re-verifies
        // right after an APK re-sign instead of serving a stale statement.
        source: "/.well-known/assetlinks.json",
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
