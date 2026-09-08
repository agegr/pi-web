import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  assertSupportedPlatform,
  createServicePlist,
  getServicePaths,
  startService,
  statusService,
  stopService,
} = require("../bin/mac-service.js");

function createFakeLaunchctl() {
  let loaded = false;
  let running = false;
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (args[0] === "print") {
      return {
        status: loaded ? 0 : 1,
        stdout: loaded && running ? "state = running\n" : "state = exited\n",
        stderr: loaded ? "" : "Could not find service\n",
      };
    }
    if (args[0] === "bootstrap") {
      loaded = true;
      running = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "kickstart") {
      loaded = true;
      running = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "bootout") {
      loaded = false;
      running = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected launchctl call: ${args.join(" ")}`);
  };
  return { calls, run };
}

function serviceOptions(root, runLaunchctl, overrides = {}) {
  return {
    platform: "darwin",
    uid: 501,
    homeDir: root,
    nodePath: "/usr/local/bin/node",
    scriptPath: "/Applications/Pi Web/bin/pi-web.js",
    packageDir: "/Applications/Pi Web",
    port: "8080",
    hostname: "127.0.0.1",
    openBrowser: false,
    environment: {
      PATH: "/usr/bin:/bin",
      PI_WEB_PASSWORD: "a&<password",
    },
    runLaunchctl,
    ...overrides,
  };
}

test("serializes a valid, escaped LaunchAgent definition", () => {
  const plist = createServicePlist({
    nodePath: "/Applications/Pi & Web/bin/node",
    scriptPath: "/Applications/Pi & Web/bin/pi-web.js",
    packageDir: "/Applications/Pi & Web",
    port: "30141",
    hostname: "host&name",
    openBrowser: false,
    environment: { PI_WEB_PASSWORD: "a\"<&'password" },
    paths: {
      stdoutPath: "/Users/test/Library/Logs/Pi & Web/pi-web.log",
      stderrPath: "/Users/test/Library/Logs/Pi & Web/pi-web.error.log",
    },
  });

  assert.match(plist, /<plist version="1\.0">/);
  assert.match(plist, /Managed by @agegr\/pi-web/);
  assert.match(plist, /<string>\/Applications\/Pi &amp; Web\/bin\/node<\/string>/);
  assert.match(plist, /<string>host&amp;name<\/string>/);
  assert.match(plist, /a&quot;&lt;&amp;&apos;password/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n  <true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\n  <true\/>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>/);
  assert.ok(!plist.includes("a\"<&'password"));
});

test("start, status, and stop make idempotent launchctl decisions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-service-"));
  try {
    const fake = createFakeLaunchctl();
    const options = serviceOptions(root, fake.run);

    const started = startService(options);
    assert.equal(started.message, "Pi Web service started.");
    assert.deepEqual(fake.calls.map(([command]) => command), ["print", "bootstrap"]);
    assert.equal(fs.statSync(getServicePaths(root).plistPath).mode & 0o777, 0o600);

    const alreadyRunning = startService(options);
    assert.equal(alreadyRunning.message, "Pi Web service is already running.");
    assert.deepEqual(fake.calls.map(([command]) => command), ["print", "bootstrap", "print"]);

    const status = statusService(options);
    assert.equal(status.running, true);
    assert.match(status.message, /Pi Web service: running/);

    assert.equal(stopService(options).message, "Pi Web service stopped.");
    assert.equal(stopService(options).message, "Pi Web service is not running.");
    assert.deepEqual(fake.calls.map(([command]) => command), [
      "print", "bootstrap", "print", "print", "print", "bootout", "print",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to replace an unrelated LaunchAgent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-service-"));
  try {
    const paths = getServicePaths(root);
    fs.mkdirSync(paths.launchAgentsDir, { recursive: true });
    fs.writeFileSync(paths.plistPath, "an unrelated plist");
    assert.throws(
      () => startService(serviceOptions(root, () => ({ status: 1, stdout: "", stderr: "" }))),
      /Refusing to overwrite/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects service commands on unsupported platforms", () => {
  assert.throws(() => assertSupportedPlatform("linux"), /only supported on macOS/);
});
