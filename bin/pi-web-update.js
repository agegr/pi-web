"use strict";

// Implements `pi-web update`: check for a newer release of @agegr/pi-web,
// then reinstall the package globally with the same package manager that
// installed it (npm, pnpm, yarn, or bun).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { name: PACKAGE_NAME, version: CURRENT_VERSION } = require("../package.json");
const VERSION_CHECK_TIMEOUT_MS = 15_000;
const PACKAGE_ROOT = path.join(__dirname, "..");
const INSTALL_METHODS = ["npm", "pnpm", "yarn", "bun"];

const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const CURRENT_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseStableVersion(version) {
  const match = STABLE_VERSION_PATTERN.exec(String(version).trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts;
}

function parseCurrentVersion(version) {
  const match = CURRENT_VERSION_PATTERN.exec(String(version).trim());
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return { parts, isPrerelease: match[4] !== undefined };
}

function isNewerVersion(candidate, current) {
  const candidateParts = parseStableVersion(candidate);
  const parsedCurrent = parseCurrentVersion(current);
  if (!candidateParts || !parsedCurrent) return false;

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== parsedCurrent.parts[index]) {
      return candidateParts[index] > parsedCurrent.parts[index];
    }
  }
  return parsedCurrent.isPrerelease;
}

// Return a preferred package manager when the installation path contains a
// manager-specific hint. Custom roots can imitate these layouts, so callers
// must still verify candidates against the managers' active global roots.
function detectInstallMethod(dir = __dirname) {
  const normalized = dir.toLowerCase().replace(/\\/g, "/");
  if (normalized.includes("/pnpm/") || normalized.includes("/.pnpm/")) return "pnpm";
  if (normalized.includes("/yarn/") || normalized.includes("/.yarn/")) return "yarn";
  if (normalized.includes("/install/global/node_modules/")) return "bun";
  if (normalized.includes("/_npx/") || normalized.includes("/npm/")) return "npm";
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

function getGlobalRootCommand(method) {
  switch (method) {
    case "npm":
    case "pnpm":
      return { command: method, args: ["root", "-g"] };
    case "yarn":
      return { command: "yarn", args: ["global", "dir", "--silent"] };
    case "bun":
      return { command: "bun", args: ["pm", "ls", "-g"] };
    default:
      throw new Error(`unsupported package manager: ${method}`);
  }
}

// Each package manager has its own registry-aware way to print the latest
// version of a package. Using the detected package manager (instead of always
// calling npm) keeps the check consistent with the registry, proxy, and
// timeout configuration the update itself will use.
function getVersionCheckCommand(method, cwd = PACKAGE_ROOT) {
  switch (method) {
    case "pnpm":
      return { command: "pnpm", args: ["view", "-g", PACKAGE_NAME, "version", "--json"], cwd };
    case "yarn":
      return { command: "yarn", args: ["info", PACKAGE_NAME, "version"], cwd };
    case "bun":
      return { command: "bun", args: ["pm", "view", PACKAGE_NAME, "version"], cwd };
    default:
      return {
        command: "npm",
        args: ["view", "-g", PACKAGE_NAME, "version", "--json", `--fetch-timeout=${VERSION_CHECK_TIMEOUT_MS}`],
        cwd,
      };
  }
}

function runCommand(command, args, cwd, spawn = spawnSync) {
  // npm/pnpm/yarn ship as .cmd shims on Windows and cannot be spawned
  // directly, so resolve them through the shell there.
  const result = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd,
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
    if (typeof parsed === "string") {
      const version = parsed.trim();
      return parseStableVersion(version) ? version : "";
    }
    if (Array.isArray(parsed)) {
      const versions = parsed
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => parseStableVersion(value));
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

function runForOutput(spec, spawn = spawnSync) {
  const result = spawn(spec.command, spec.args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: VERSION_CHECK_TIMEOUT_MS,
    cwd: spec.cwd,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || "").trim() || `${spec.command} exited with code ${result.status ?? "unknown"}`;
    throw new Error(detail);
  }
  return String(result.stdout || "");
}

function getGlobalInstallRoot(method, cwd = PACKAGE_ROOT, spawn = spawnSync) {
  const output = runForOutput({ ...getGlobalRootCommand(method), cwd }, spawn);
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (method === "bun") {
    const headerMatch = /^(.+) node_modules \(\d+\)$/.exec(lines[0] || "");
    const globalProjectPath = headerMatch?.[1];
    if (!globalProjectPath || !path.isAbsolute(globalProjectPath)) {
      throw new Error("bun did not return an absolute global project path");
    }
    return path.resolve(globalProjectPath, "node_modules");
  }

  const reportedPath = lines.find((line) => path.isAbsolute(line));
  if (!reportedPath) throw new Error(`${method} did not return an absolute global install path`);

  if (method === "yarn") return path.resolve(reportedPath, "node_modules");
  return path.resolve(reportedPath);
}

function comparableRealPath(filePath, realpath = fs.realpathSync.native) {
  const normalized = path.normalize(realpath(path.resolve(filePath)));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertNotNpxInstall(packageRoot) {
  const normalizedPackageRoot = packageRoot.replace(/\\/g, "/").toLowerCase();
  if (normalizedPackageRoot.includes("/_npx/")) {
    throw new Error("the running copy is an npx temporary install");
  }
}

function validateGlobalInstall(method, packageRoot = PACKAGE_ROOT, options = {}) {
  assertNotNpxInstall(packageRoot);

  const spawn = options.spawnSync || spawnSync;
  const realpath = options.realpathSync || fs.realpathSync.native;
  const globalRoot = getGlobalInstallRoot(method, packageRoot, spawn);
  const globalPackageRoot = path.join(globalRoot, PACKAGE_NAME);

  let runningPath;
  let globalPath;
  try {
    runningPath = comparableRealPath(packageRoot, realpath);
    globalPath = comparableRealPath(globalPackageRoot, realpath);
  } catch (error) {
    throw new Error(`could not resolve the active global install: ${error.message}`);
  }
  if (runningPath !== globalPath) {
    throw new Error(`the running copy is not ${method}'s active global install`);
  }

  return {
    globalRoot,
    packageRoot: globalPackageRoot,
    packageJsonPath: path.join(globalPackageRoot, "package.json"),
  };
}

function resolveGlobalInstall(packageRoot = PACKAGE_ROOT, options = {}) {
  const validationOptions = {
    spawnSync: options.spawnSync,
    realpathSync: options.realpathSync,
  };

  if (options.method && options.method !== "unknown") {
    return {
      method: options.method,
      install: validateGlobalInstall(options.method, packageRoot, validationOptions),
    };
  }

  assertNotNpxInstall(packageRoot);
  const detectedMethod = detectInstallMethod(path.join(packageRoot, "bin"));
  const methods = detectedMethod === "unknown"
    ? INSTALL_METHODS
    : [detectedMethod, ...INSTALL_METHODS.filter((method) => method !== detectedMethod)];
  const matches = [];
  for (const method of methods) {
    try {
      matches.push({
        method,
        install: validateGlobalInstall(method, packageRoot, validationOptions),
      });
    } catch {
      // Missing managers and non-matching global roots are expected while probing.
    }
  }

  if (matches.length === 0) {
    throw new Error("no supported package manager points to the running copy");
  }
  if (matches.length > 1) {
    throw new Error(`multiple package managers point to the running copy: ${matches.map(({ method }) => method).join(", ")}`);
  }
  return matches[0];
}

function getLatestVersion(method, cwd = PACKAGE_ROOT, spawn = spawnSync) {
  const check = getVersionCheckCommand(method, cwd);
  const latestVersion = parseVersionOutput(method, runForOutput(check, spawn));
  if (!latestVersion) {
    throw new Error(`${method} returned an empty or invalid stable version`);
  }
  return latestVersion;
}

function getManualInstallHint(method = "npm", version = "latest") {
  const update = getUpdateCommand(method, version);
  return [update.command, ...update.args].join(" ");
}

function readInstalledVersion(packageJsonPath, readFile = fs.readFileSync) {
  const manifest = JSON.parse(readFile(packageJsonPath, "utf8"));
  return typeof manifest.version === "string" ? manifest.version : "";
}

function runUpdateInternal(options = {}) {
  const packageRoot = options.packageRoot || PACKAGE_ROOT;
  const currentVersion = options.currentVersion || CURRENT_VERSION;
  const detectedMethod = options.method || detectInstallMethod(path.join(packageRoot, "bin"));
  const spawn = options.spawnSync || spawnSync;
  const readFile = options.readFileSync || fs.readFileSync;
  const logger = options.console || console;

  let method;
  let install;
  try {
    ({ method, install } = resolveGlobalInstall(packageRoot, {
      method: options.method,
      spawnSync: spawn,
      realpathSync: options.realpathSync,
    }));
  } catch (error) {
    logger.error(`error: cannot update this installation safely: ${error.message}`);
    logger.error(`Update it manually with: ${getManualInstallHint(detectedMethod === "unknown" ? "npm" : detectedMethod)}`);
    return 1;
  }

  logger.log(`Checking for updates to ${PACKAGE_NAME}...`);
  let latestVersion;
  try {
    latestVersion = getLatestVersion(method, install.globalRoot, spawn);
  } catch (error) {
    logger.error(`error: could not check for updates: ${error.message}`);
    logger.error(`Update it manually with: ${getManualInstallHint(method)}`);
    return 1;
  }
  if (!isNewerVersion(latestVersion, currentVersion)) {
    logger.log(`${PACKAGE_NAME} is already up to date (v${currentVersion})`);
    return 0;
  }

  const updateCommand = getUpdateCommand(method, latestVersion);
  const commandDisplay = [updateCommand.command, ...updateCommand.args].join(" ");
  logger.log(`Updating ${PACKAGE_NAME} from v${currentVersion} to v${latestVersion} with ${commandDisplay}...`);
  try {
    runCommand(updateCommand.command, updateCommand.args, install.globalRoot, spawn);
    const installedVersion = readInstalledVersion(install.packageJsonPath, readFile);
    if (installedVersion !== latestVersion) {
      throw new Error(`installed version is v${installedVersion || "unknown"}, expected v${latestVersion}`);
    }
  } catch (error) {
    logger.error(`error: update failed: ${error.message}`);
    logger.error(`If this keeps failing, run the command yourself: ${getManualInstallHint(method, latestVersion)}`);
    return 1;
  }
  logger.log(`${PACKAGE_NAME} updated to v${latestVersion}. Restart pi-web to use the new version.`);
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
  getGlobalInstallRoot,
  getGlobalRootCommand,
  getManualInstallHint,
  getUpdateCommand,
  getVersionCheckCommand,
  isNewerVersion,
  parseVersionOutput,
  resolveGlobalInstall,
  runUpdateInternal,
  runUpdate,
  validateGlobalInstall,
};
