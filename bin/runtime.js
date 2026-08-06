"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { delimiter, join } = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homedir } = require("os");

const MIN_NODE_VERSION = "22.19.0";
const MIN_BUN_VERSION = "1.3.14";

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  if (!match) return null;
  return match.slice(1).map(Number);
}

function isAtLeast(version, minimum) {
  const current = parseVersion(version);
  const floor = parseVersion(minimum);
  if (!current || !floor) return false;

  for (let index = 0; index < floor.length; index += 1) {
    if (current[index] > floor[index]) return true;
    if (current[index] < floor[index]) return false;
  }
  return true;
}

function isNodeVersionSupported(version) {
  return isAtLeast(version, MIN_NODE_VERSION);
}

function getUnsupportedNodeVersionMessage(version) {
  return [
    `omp-web requires Node.js ${MIN_NODE_VERSION} or newer.`,
    `Current Node.js version: ${version}.`,
    "Upgrade Node.js and try again: https://nodejs.org/",
  ].join("\n");
}

function getUnsupportedBunVersionMessage(version) {
  return [
    `omp-web requires Bun ${MIN_BUN_VERSION} or newer.`,
    `Current Bun version: ${version}.`,
    "Upgrade Bun and try again: https://bun.sh/",
  ].join("\n");
}

function isBunVersionSupported(version) {
  return isAtLeast(version, MIN_BUN_VERSION);
}

function bunExecutableName() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

/**
 * Locate a Bun executable.
 *
 * omp's SDK (`@oh-my-pi/pi-*`) ships TypeScript sources and imports `bun:`
 * builtins, so the server half of omp-web can only run on the Bun runtime.
 * Order: the current process (when omp-web itself was launched by Bun), an
 * explicit `OMP_WEB_BUN` override, `$BUN_INSTALL/bin`, `~/.bun/bin`, `$PATH`.
 */
function resolveBunPath(env = process.env) {
  // An explicit override wins even when Bun is already running us, so an
  // operator can pin a specific build without changing PATH.
  const candidates = [];
  if (env.OMP_WEB_BUN) candidates.push(env.OMP_WEB_BUN);
  if (!env.OMP_WEB_BUN && process.versions.bun && process.execPath) return process.execPath;

  if (env.BUN_INSTALL) candidates.push(join(env.BUN_INSTALL, "bin", bunExecutableName()));
  candidates.push(join(homedir(), ".bun", "bin", bunExecutableName()));
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir) candidates.push(join(dir, bunExecutableName()));
  }

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Unreadable PATH entry — keep looking.
    }
  }
  return null;
}

function getMissingBunMessage() {
  return [
    "omp-web could not find a Bun runtime.",
    "",
    "The omp SDK (@oh-my-pi/pi-*) is distributed as TypeScript sources and uses",
    "Bun-only builtins, so omp-web serves its API routes on Bun — exactly like",
    "the omp CLI itself.",
    "",
    "Install Bun and try again:",
    "  curl -fsSL https://bun.sh/install | bash        # macOS / Linux",
    '  powershell -c "irm bun.sh/install.ps1 | iex"    # Windows',
    "",
    "Already installed somewhere unusual? Point omp-web at it:",
    "  OMP_WEB_BUN=/path/to/bun omp-web",
  ].join("\n");
}

module.exports = {
  MIN_BUN_VERSION,
  MIN_NODE_VERSION,
  getMissingBunMessage,
  getUnsupportedBunVersionMessage,
  getUnsupportedNodeVersionMessage,
  isBunVersionSupported,
  isNodeVersionSupported,
  resolveBunPath,
};
