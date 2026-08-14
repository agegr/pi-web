import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// Windows user-profile root contains shell-folder symlinks ("Cookies",
// "Application Data", "My Documents", ...) that webpack's glob walks into
// during compilation and fails with EPERM on protected targets. Next.js 16
// names this top-level `outputFileTracingExcludes` (Record<string, string[]>);
// older docs called it `experimental.outputFileTracingIgnores` (array).
// Keep the trace excludes up to date so the post-build trace phase never
// re-introduces these failures.
void homedir;
const WINDOWS_PROFILE_SYMLINKS = [
  "Cookies",
  "Application Data",
  "My Documents",
  "My Music",
  "My Pictures",
  "My Videos",
  "NetHood",
  "PrintHood",
  "Recent",
  "SendTo",
  "Start Menu",
  "Templates",
  "Local Settings",
  "Desktop",
  "Documents",
  "Downloads",
  "Favorites",
  "Links",
  "Music",
  "Pictures",
  "Saved Games",
  "Searches",
  "Videos",
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  outputFileTracingExcludes: {
    "**/*": WINDOWS_PROFILE_SYMLINKS.map((name) => `**/${name}/**`),
  },
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // "100.*.*.*" covers Tailscale's 100.64.0.0/10 CGNAT range so `next dev`
  // does not reject requests arriving over a tailnet.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "100.*.*.*"],
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