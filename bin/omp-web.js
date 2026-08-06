#!/usr/bin/env node
"use strict";

const {
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  getUnsupportedNodeVersionMessage,
  isBunVersionSupported,
  isNodeVersionSupported,
  resolveBunPath,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("./runtime");

if (process.versions.bun && !isBunVersionSupported(process.versions.bun)) {
  console.error(getUnsupportedBunVersionMessage(process.versions.bun));
  process.exit(1);
}

if (!process.versions.bun && !isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./omp-web-options");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx/bunx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { port, hostname, openBrowser } = parseLaunchOptions();
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const passwordEnabled = Boolean(process.env.OMP_WEB_PASSWORD);

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const bunPath = resolveBunPath();
if (!bunPath) {
  console.error(getMissingBunMessage());
  process.exit(1);
}

if (!loopbackHostnames.has(hostname)) {
  if (passwordEnabled) {
    console.warn(
      `Warning: omp-web is listening on ${hostname} with Basic Auth over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
    );
  } else {
    console.warn(
      `Warning: omp-web is listening on ${hostname} without authentication. Only use this on a trusted network.`,
    );
  }
}

// `--bun` forces Bun's own runtime for next's CLI entry (it would otherwise
// hand shebang'd scripts to node). The omp SDK ships TypeScript sources and
// `bun:` builtins, so the API routes only resolve under Bun.
const child = spawn(bunPath, ["--bun", nextBin, "start", "-p", port, "-H", hostname], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, OMP_WEB_HOSTNAME: hostname },
});

child.on("error", (error) => {
  console.error(`Failed to launch omp-web through Bun (${bunPath}): ${error.message}`);
  process.exit(1);
});

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
