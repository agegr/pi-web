import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { detectInstallMethod, getUpdateCommand, isNewerVersion } = require("./pi-web-update.js");

test("detects newer stable versions", () => {
  assert.equal(isNewerVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerVersion("0.8.8-beta.1", "0.8.7"), false);
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
    args: ["install", "-g", "@agegr/pi-web@0.8.8"],
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
