"use strict";

// Implements `pi-web update`: check for a newer release of @agegr/pi-web,
// then reinstall the package globally with the same package manager that
// installed it (npm, pnpm, yarn, or bun).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { name: PACKAGE_NAME, version: CURRENT_VERSION } = require("../package.json");
const VERSION_CHECK_TIMEOUT_MS = 15_000;

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseStableVersion(version) {
  const match = STABLE_VERSION_PATTERN.exec(String(version).trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts;
}

function isNewerVersion(candidate, current) {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

// Detect the package manager that installed this copy of pi-web from the
// installation path. Global installs always live under
// `<something>/node_modules/@agegr/pi-web/bin`, and each package manager uses
// a recognizable directory layout above that.
function detectInstallMethod(dir = __dirname) {
  const normalized = dir.toLowerCase().replace(/\\/g, "/");
  if (normalized.includes("/pnpm/") || normalized.includes("/.pnpm/")) return "pnpm";
  if (normalized.includes("/yarn/") || normalized.includes("/.yarn/")) return "yarn";
  if (normalized.includes("/install/global/node_modules/")) return "bun";
  if (normalized.includes("/npm/") || normalized.includes("/node_modules/")) return "npm";
  return "unknown";
}

function getUpdateCommand(method, version) {
  const spec = `${PACKAGE_NAME}@${version}`;
  switch (method) {
    case "pnpm":
      return { command: "pnpm", args: ["add", "-g", spec] };
    case "yarn":
      return { command: "yarn", args: ["global", "add", spec] };
    case "bun":
      return { command: "bun", args: ["add", "-g", spec] };
    default:
      return { command: "npm", args: ["install", "-g", spec] };
  }
}

// Each package manager has its own registry-aware way to print the latest
// version of a package. Using the detected package manager (instead of always
// calling npm) keeps the check consistent with the registry, proxy, and
// timeout configuration the update itself will use.
function getVersionCheckCommand(method) {
  switch (method) {
    case "pnpm":
      return { command: "pnpm", args: ["view", PACKAGE_NAME, "version", "--json"] };
    case "yarn":
      return { command: "yarn", args: ["info", PACKAGE_NAME, "version"] };
    case "bun":
      // `bun pm view` resolves the workspace from the current directory, so
      // run it from the package directory, which always ships a package.json.
      return {
        command: "bun",
        args: ["pm", "view", PACKAGE_NAME, "version"],
        cwd: path.join(__dirname, ".."),
      };
    default:
      return {
        command: "npm",
        args: ["view", PACKAGE_NAME, "version", "--json", `--fetch-timeout=${VERSION_CHECK_TIMEOUT_MS}`],
      };
  }
}

function runCommand(command, args) {
  // npm/pnpm/yarn ship as .cmd shims on Windows and cannot be spawned
  // directly, so resolve them through the shell there.
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
  }
}

// npm and pnpm print JSON (a quoted string, or an array on newer npm); yarn
// and bun print the bare version.
function parseVersionOutput(method, stdout) {
  if (method === "npm" || method === "pnpm") {
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return "";
    }
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed)) {
      const versions = parsed.filter((value) => typeof value === "string");
      if (versions.length > 0) return versions[versions.length - 1];
    }
    return "";
  }
  // yarn and bun print the bare version; scan for the first semver-looking
  // line because yarn appends "Done in ..." noise after the value.
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (STABLE_VERSION_PATTERN.test(line)) return line;
  }
  return "";
}

function getLatestVersion(method) {
  const check = getVersionCheckCommand(method);
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: VERSION_CHECK_TIMEOUT_MS,
    cwd: check.cwd,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim() || `${check.command} exited with code ${result.status}`;
    throw new Error(detail);
  }
  return parseVersionOutput(method, result.stdout);
}

function getManualInstallHint(version = "latest") {
  return `npm install -g ${PACKAGE_NAME}@${version}`;
}

function runUpdateInternal() {
  const method = detectInstallMethod();
  if (method === "unknown") {
    console.error("error: could not determine how pi-web was installed.");
    console.error(`Update it manually with: ${getManualInstallHint()}`);
    return 1;
  }

  console.log(`Checking for updates to ${PACKAGE_NAME}...`);
  let latestVersion;
  try {
    latestVersion = getLatestVersion(method);
  } catch (error) {
    console.error(`error: could not check for updates: ${error.message}`);
    console.error(`Update it manually with: ${getManualInstallHint()}`);
    return 1;
  }
  if (!latestVersion || !isNewerVersion(latestVersion, CURRENT_VERSION)) {
    console.log(`${PACKAGE_NAME} is already up to date (v${CURRENT_VERSION})`);
    return 0;
  }

  const updateCommand = getUpdateCommand(method, latestVersion);
  const commandDisplay = [updateCommand.command, ...updateCommand.args].join(" ");
  console.log(`Updating ${PACKAGE_NAME} from v${CURRENT_VERSION} to v${latestVersion} with ${commandDisplay}...`);
  try {
    runCommand(updateCommand.command, updateCommand.args);
  } catch (error) {
    console.error(`error: update failed: ${error.message}`);
    console.error(`If this keeps failing, run the command yourself: ${getManualInstallHint(latestVersion)}`);
    return 1;
  }
  console.log(`${PACKAGE_NAME} updated to v${latestVersion}. Restart pi-web to use the new version.`);
  return 0;
}

function runUpdate() {
  try {
    return runUpdateInternal();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Update it manually with: ${getManualInstallHint()}`);
    return 1;
  }
}

module.exports = {
  detectInstallMethod,
  getUpdateCommand,
  getVersionCheckCommand,
  isNewerVersion,
  parseVersionOutput,
  runUpdate,
};
