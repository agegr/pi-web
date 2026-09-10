import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { defaultUpdateSourceDir, getAppInstallPaths, launchAppUpdate, readAppInstallState } = await jiti.import("./app-update-install.ts");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-update-home-"));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-update-source-"));
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "@agegr/pi-web" }));
  fs.writeFileSync(path.join(source, "package-lock.json"), "{}");
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  });
  return { home, source };
}

test("launches a detached updater for a validated absolute source directory", (t) => {
  const { home, source } = fixture(t);
  const calls = [];
  let unrefCalled = false;
  const result = launchAppUpdate(source, {
    platform: "darwin",
    homeDir: home,
    helperPath: "/app/detached-update.js",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return { unref() { unrefCalled = true; } };
    },
  });

  const paths = getAppInstallPaths(home);
  assert.equal(result.sourceDir, source);
  assert.equal(result.logPath, paths.logPath);
  assert.equal(unrefCalled, true);
  assert.deepEqual(calls[0].args, ["/app/detached-update.js", source, paths.statePath, paths.lockPath]);
  assert.equal(calls[0].options.detached, true);
});

test("reports persisted updater state and rejects unsupported or invalid launches", (t) => {
  const { home, source } = fixture(t);
  const paths = getAppInstallPaths(home);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.statePath, JSON.stringify({ status: "failed", error: "boom" }));
  assert.deepEqual(readAppInstallState(home), { status: "failed", error: "boom" });
  assert.equal(defaultUpdateSourceDir(source), source);

  assert.throws(() => launchAppUpdate(source, { platform: "linux", homeDir: home }), /macOS/);
  assert.throws(() => launchAppUpdate("relative", { platform: "darwin", homeDir: home }), /absolute/);
});
