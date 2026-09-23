import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
// The demo mirrors the Pi Web release it was copied from, so report the parent
// package's versions in the UI (About / update checks).
const parentPackage = JSON.parse(readFileSync(join(configDir, "../package.json"), "utf8")) as {
  version: string;
  dependencies?: Record<string, string>;
};
const piVersion = parentPackage.dependencies?.["@earendil-works/pi-coding-agent"] ?? "unknown";

// GitHub Pages serves a project site from /<repo>/. The workflow passes the
// prefix in PAGES_BASE_PATH; local builds and `next dev` run at the root.
const basePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  outputFileTracingRoot: configDir,
  turbopack: { root: configDir },
  images: { unoptimized: true },
  // Next writes AGENTS.md / CLAUDE.md into the project on `next dev` otherwise.
  agentRules: false,
  // `npm run dev` binds 127.0.0.1; Next 16 treats other hosts as cross-origin.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_APP_VERSION: parentPackage.version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
