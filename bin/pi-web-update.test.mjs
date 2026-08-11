import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  detectInstallMethod,
  getGlobalInstallRoot,
  getGlobalRootCommand,
  getManualInstallHint,
  getUpdateCommand,
  getVersionCheckCommand,
  isNewerVersion,
  parseVersionOutput,
  runUpdateInternal,
  validateGlobalInstall,
} = require("./pi-web-update.js");

// mirrors path.join(__dirname, "..") inside the module
const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("detects newer stable versions", () => {
  assert.equal(isNewerVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.8.8", "0.8.8-beta.1"), true);
  assert.equal(isNewerVersion("0.9.0", "0.8.8-rc.2"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.8-beta.1", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.7", "0.8.8-beta.1"), false);
  assert.equal(isNewerVersion("invalid", "0.8.7"), false);
});

test("detects the package manager from the installation path", () => {
  assert.equal(detectInstallMethod("C:/Users/x/AppData/Roaming/npm/node_modules/@agegr/pi-web/bin"), "npm");
  assert.equal(detectInstallMethod("/usr/local/lib/node_modules/@agegr/pi-web/bin"), "npm");
  assert.equal(detectInstallMethod("C:/Users/x/AppData/Local/npm-cache/_npx/abc123/node_modules/@agegr/pi-web/bin"), "npm");
  assert.equal(detectInstallMethod("/home/x/.npm/_npx/abc123/node_modules/@agegr/pi-web/bin"), "npm");
  assert.equal(detectInstallMethod("C:/Users/x/AppData/Local/pnpm/global/5/node_modules/.pnpm/@agegr+pi-web@0.8.7/node_modules/@agegr/pi-web/bin"), "pnpm");
  assert.equal(detectInstallMethod("/home/x/.local/share/pnpm/global/5/node_modules/@agegr/pi-web/bin"), "pnpm");
  assert.equal(detectInstallMethod("C:/Users/x/AppData/Local/Yarn/Config/global/node_modules/@agegr/pi-web/bin"), "yarn");
  assert.equal(detectInstallMethod("/home/x/.yarn/global/node_modules/@agegr/pi-web/bin"), "yarn");
  assert.equal(detectInstallMethod("C:/Users/x/.bun/install/global/node_modules/@agegr/pi-web/bin"), "bun");
  assert.equal(detectInstallMethod("/home/x/.bun/install/global/node_modules/@agegr/pi-web/bin"), "bun");
});

test("does not guess a package manager for non-global checkouts", () => {
  assert.equal(detectInstallMethod("C:/Users/x/projects/pi-web/bin"), "unknown");
  assert.equal(detectInstallMethod("/home/x/pi-web/bin"), "unknown");
});

test("builds the update command for each package manager", () => {
  assert.deepEqual(getUpdateCommand("npm", "0.8.8"), {
    command: "npm",
    args: ["install", "-g", "@agegr/pi-web@0.8.8"],
  });
  assert.deepEqual(getUpdateCommand("pnpm", "0.8.8"), {
    command: "pnpm",
    args: ["add", "-g", "@agegr/pi-web@0.8.8"],
  });
  assert.deepEqual(getUpdateCommand("yarn", "0.8.8"), {
    command: "yarn",
    args: ["global", "add", "@agegr/pi-web@0.8.8"],
  });
  assert.deepEqual(getUpdateCommand("bun", "0.8.8"), {
    command: "bun",
    args: ["add", "-g", "@agegr/pi-web@0.8.8"],
  });
});

test("builds the global root command for each package manager", () => {
  assert.deepEqual(getGlobalRootCommand("npm"), { command: "npm", args: ["root", "-g"] });
  assert.deepEqual(getGlobalRootCommand("pnpm"), { command: "pnpm", args: ["root", "-g"] });
  assert.deepEqual(getGlobalRootCommand("yarn"), { command: "yarn", args: ["global", "dir", "--silent"] });
  assert.deepEqual(getGlobalRootCommand("bun"), { command: "bun", args: ["pm", "ls", "-g"] });
});

test("builds the version check command for each package manager", () => {
  assert.deepEqual(getVersionCheckCommand("npm"), {
    command: "npm",
    args: ["view", "-g", "@agegr/pi-web", "version", "--json", "--fetch-timeout=15000"],
    cwd: PACKAGE_DIR,
  });
  assert.deepEqual(getVersionCheckCommand("pnpm"), {
    command: "pnpm",
    args: ["view", "-g", "@agegr/pi-web", "version", "--json"],
    cwd: PACKAGE_DIR,
  });
  assert.deepEqual(getVersionCheckCommand("yarn"), {
    command: "yarn",
    args: ["info", "@agegr/pi-web", "version"],
    cwd: PACKAGE_DIR,
  });
  const bun = getVersionCheckCommand("bun");
  assert.deepEqual(bun, {
    command: "bun",
    args: ["pm", "view", "@agegr/pi-web", "version"],
    cwd: PACKAGE_DIR,
  });
});

test("parses version output from each package manager", () => {
  assert.equal(parseVersionOutput("npm", '"0.8.8"'), "0.8.8");
  assert.equal(parseVersionOutput("npm", '" 0.8.8 "'), "0.8.8");
  assert.equal(parseVersionOutput("npm", '["0.8.8"]'), "0.8.8");
  assert.equal(parseVersionOutput("pnpm", '"0.8.8"'), "0.8.8");
  assert.equal(parseVersionOutput("yarn", "0.8.8\n"), "0.8.8");
  assert.equal(parseVersionOutput("yarn", "0.8.8\nDone in 0.11s.\n"), "0.8.8");
  assert.equal(parseVersionOutput("bun", "0.8.8\n"), "0.8.8");
  assert.equal(parseVersionOutput("npm", "not json"), "");
  assert.equal(parseVersionOutput("npm", '"0.8.9-beta.1"'), "");
  assert.equal(parseVersionOutput("pnpm", '["0.8.8", "0.8.9-beta.1"]'), "0.8.8");
  assert.equal(parseVersionOutput("bun", ""), "");
});

test("derives each package manager's global node_modules directory", () => {
  const outputs = {
    npm: "npm warning text\n/prefix/npm/node_modules\n",
    pnpm: "pnpm warning text\n/prefix/pnpm/global/5/node_modules\n",
    yarn: "yarn global v1.22.22\n/prefix/yarn/global\nDone in 0.03s.\n",
    bun: "/custom Bun/global project node_modules (2)\n├── first-package@1.0.0\n└── second-package@2.0.0\n",
  };
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: outputs[command], stderr: "" };
  };

  assert.equal(getGlobalInstallRoot("npm", PACKAGE_DIR, spawn), path.resolve("/prefix/npm/node_modules"));
  assert.equal(getGlobalInstallRoot("pnpm", PACKAGE_DIR, spawn), path.resolve("/prefix/pnpm/global/5/node_modules"));
  assert.equal(getGlobalInstallRoot("yarn", PACKAGE_DIR, spawn), path.resolve("/prefix/yarn/global/node_modules"));
  assert.equal(getGlobalInstallRoot("bun", PACKAGE_DIR, spawn), path.resolve("/custom Bun/global project/node_modules"));
  assert.deepEqual(calls.at(-1), { command: "bun", args: ["pm", "ls", "-g"] });
});

test("manual install hints use the detected package manager", () => {
  assert.equal(getManualInstallHint("npm"), "npm install -g @agegr/pi-web@latest");
  assert.equal(getManualInstallHint("pnpm", "0.8.8"), "pnpm add -g @agegr/pi-web@0.8.8");
  assert.equal(getManualInstallHint("yarn", "0.8.8"), "yarn global add @agegr/pi-web@0.8.8");
  assert.equal(getManualInstallHint("bun", "0.8.8"), "bun add -g @agegr/pi-web@0.8.8");
});

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-update-test-"));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  return dir;
}

function writeManifest(packageRoot, version) {
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@agegr/pi-web",
    version,
  }));
}

function makeGlobalInstall(t, version = "0.8.7") {
  const tempDir = makeTempDir(t);
  const globalRoot = path.join(tempDir, "global", "node_modules");
  const packageRoot = path.join(globalRoot, "@agegr", "pi-web");
  writeManifest(packageRoot, version);
  return { globalRoot, packageRoot, packageJsonPath: path.join(packageRoot, "package.json"), tempDir };
}

function makeLogger() {
  const logs = [];
  const errors = [];
  return {
    errors,
    logs,
    console: {
      error: (...parts) => errors.push(parts.join(" ")),
      log: (...parts) => logs.push(parts.join(" ")),
    },
  };
}

function makeNpmSpawn({ globalRoot, latestOutput = '"0.8.8"', onInstall }) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (command !== "npm") throw new Error(`unexpected command: ${command}`);
    if (args[0] === "root") return { status: 0, stdout: `${globalRoot}\n`, stderr: "" };
    if (args[0] === "view") return { status: 0, stdout: latestOutput, stderr: "" };
    if (args[0] === "install") {
      onInstall?.();
      return { status: 0 };
    }
    throw new Error(`unexpected npm arguments: ${args.join(" ")}`);
  };
  return { calls, spawn };
}

test("accepts a global package symlink when its real path matches the running copy", (t) => {
  const tempDir = makeTempDir(t);
  const globalRoot = path.join(tempDir, "global", "node_modules");
  const globalPackageRoot = path.join(globalRoot, "@agegr", "pi-web");
  const storePackageRoot = path.join(tempDir, "store", "pi-web");
  writeManifest(storePackageRoot, "0.8.7");
  fs.mkdirSync(path.dirname(globalPackageRoot), { recursive: true });
  fs.symlinkSync(storePackageRoot, globalPackageRoot, process.platform === "win32" ? "junction" : "dir");
  const { spawn } = makeNpmSpawn({ globalRoot });

  const install = validateGlobalInstall("npm", storePackageRoot, { spawnSync: spawn });
  assert.equal(install.packageRoot, globalPackageRoot);
  assert.equal(install.packageJsonPath, path.join(globalPackageRoot, "package.json"));
});

test("rejects npx and a package under a different global prefix", (t) => {
  const { globalRoot, tempDir } = makeGlobalInstall(t);
  const npxPackageRoot = path.join(tempDir, ".npm", "_npx", "abc", "node_modules", "@agegr", "pi-web");
  const otherPrefixPackageRoot = path.join(tempDir, "old-prefix", "node_modules", "@agegr", "pi-web");
  writeManifest(npxPackageRoot, "0.8.7");
  writeManifest(otherPrefixPackageRoot, "0.8.7");
  const { calls, spawn } = makeNpmSpawn({ globalRoot });

  assert.throws(
    () => validateGlobalInstall("npm", npxPackageRoot, { spawnSync: spawn }),
    /npx temporary install/,
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () => validateGlobalInstall("npm", otherPrefixPackageRoot, { spawnSync: spawn }),
    /not npm's active global install/,
  );
  assert.equal(calls.filter((call) => call.args[0] === "install").length, 0);
});

test("invalid registry version output fails instead of reporting up to date", (t) => {
  const { globalRoot, packageRoot } = makeGlobalInstall(t);
  const logger = makeLogger();
  const { calls, spawn } = makeNpmSpawn({ globalRoot, latestOutput: '"not-a-version"' });

  const status = runUpdateInternal({
    console: logger.console,
    currentVersion: "0.8.7",
    method: "npm",
    packageRoot,
    spawnSync: spawn,
  });

  assert.equal(status, 1);
  assert.match(logger.errors.join("\n"), /empty or invalid stable version/);
  assert.doesNotMatch(logger.logs.join("\n"), /already up to date/);
  assert.equal(calls.filter((call) => call.args[0] === "install").length, 0);
});

test("update commands share a cwd and verify the original package manifest", (t) => {
  const { globalRoot, packageRoot, packageJsonPath } = makeGlobalInstall(t);
  const logger = makeLogger();
  const { calls, spawn } = makeNpmSpawn({
    globalRoot,
    onInstall: () => writeManifest(packageRoot, "0.8.8"),
  });

  const status = runUpdateInternal({
    console: logger.console,
    currentVersion: "0.8.7",
    method: "npm",
    packageRoot,
    spawnSync: spawn,
  });

  assert.equal(status, 0);
  const viewCall = calls.find((call) => call.args[0] === "view");
  const installCall = calls.find((call) => call.args[0] === "install");
  assert.equal(viewCall.options.cwd, globalRoot);
  assert.equal(installCall.options.cwd, globalRoot);
  assert.equal(JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version, "0.8.8");
  assert.match(logger.logs.at(-1), /updated to v0\.8\.8/);
});

test("reports failure when the package manager leaves the original version in place", (t) => {
  const { globalRoot, packageRoot } = makeGlobalInstall(t);
  const logger = makeLogger();
  const { spawn } = makeNpmSpawn({ globalRoot });

  const status = runUpdateInternal({
    console: logger.console,
    currentVersion: "0.8.7",
    method: "npm",
    packageRoot,
    spawnSync: spawn,
  });

  assert.equal(status, 1);
  assert.match(logger.errors.join("\n"), /installed version is v0\.8\.7, expected v0\.8\.8/);
  assert.doesNotMatch(logger.logs.join("\n"), /updated to v0\.8\.8/);
});
