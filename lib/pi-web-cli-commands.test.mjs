import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getHelpText, parseCommandLine } = require("../bin/pi-web-options.js");
const records = require("../bin/run-records.js");
const { getInstallKind, isNewerStableVersion, runUpdate } = require("../bin/pi-web-update.js");
const { runCommand, stopServer } = require("../bin/pi-web-commands.js");
const { wireChildProcessLifecycle } = require("../bin/process-lifecycle.js");
const packageJson = require("../package.json");
const cliPath = fileURLToPath(new URL("../bin/pi-web.js", import.meta.url));

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function record(port, pid = process.pid) {
  return {
    pid,
    port,
    hostname: "127.0.0.1",
    url: `http://127.0.0.1:${port}`,
    version: "1.0.0",
    startedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("parses each command, -v and options after the command", () => {
  for (const command of ["version", "status", "stop", "open", "update"]) {
    assert.equal(parseCommandLine([command], {}).command, command);
  }
  assert.equal(parseCommandLine(["-v"], {}).command, "version");
  assert.equal(parseCommandLine(["--version"], {}).command, "version");
  assert.equal(parseCommandLine(["stop", "--port", "8080"], {}).port, "8080");
  assert.equal(parseCommandLine(["open", "-p", "9000"], {}).port, "9000");
  assert.equal(parseCommandLine(["stop"], {}).port, undefined);
  assert.equal(parseCommandLine(["update", "--check"], {}).check, true);
  assert.deepEqual(parseCommandLine(["status", "--help"], {}), { command: "status", help: true });
  assert.equal(parseCommandLine([], {}).command, "start");
  assert.equal(parseCommandLine(["-p", "8080"], {}).port, "8080");
  assert.match(getHelpText(), /Usage: pi-web \[command\] \[options\]/);
  assert.match(getHelpText(), /update \[--check\]/);
});

test("rejects unknown commands, foreign options and bad ports", () => {
  assert.throws(() => parseCommandLine(["serve"], {}), /Unexpected argument.*\nUse --help/);
  assert.throws(() => parseCommandLine(["status", "--port", "1"], {}), /Use --help/);
  assert.throws(() => parseCommandLine(["update", "--force"], {}), /Use --help/);
  assert.throws(() => parseCommandLine(["stop", "extra"], {}), /Use --help/);
  assert.throws(() => parseCommandLine(["stop", "-p", "x"], {}), /Port must be/);

  const unknown = spawnSync(process.execPath, [cliPath, "serve"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Use --help/);
});

test("CLI prints the package version", () => {
  for (const arg of ["version", "-v", "--version"]) {
    const result = spawnSync(process.execPath, [cliPath, arg], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), packageJson.version);
  }
});

test("compares stable versions only", () => {
  assert.equal(isNewerStableVersion("0.11.1", "0.11.0"), true);
  assert.equal(isNewerStableVersion("1.0.0", "0.99.99"), true);
  assert.equal(isNewerStableVersion("0.10.9", "0.11.0"), false);
  assert.equal(isNewerStableVersion("0.11.0", "0.11.0"), false);
  assert.equal(isNewerStableVersion("0.12.0-beta.1", "0.11.0"), false);
  assert.equal(isNewerStableVersion("0.12.0", "dev"), false);
});

test("writes, reads and removes run records; deletes stale ones", (t) => {
  const dir = path.join(tempDir(t), "run");
  records.writeRunRecord(dir, record(4000));
  records.writeRunRecord(dir, record(3000));
  records.writeRunRecord(dir, record(5000, 999_999));
  fs.writeFileSync(path.join(dir, "6000.json"), "{not json");

  const alive = (pid) => pid === process.pid;
  assert.deepEqual(records.listRunRecords(dir, alive).map((r) => r.port), [3000, 4000]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["3000.json", "4000.json"]);

  records.removeRunRecord(dir, 3000, 12345);
  assert.ok(fs.existsSync(path.join(dir, "3000.json")), "another pid's record stays");
  records.removeRunRecord(dir, 3000, process.pid);
  assert.ok(!fs.existsSync(path.join(dir, "3000.json")));
  assert.deepEqual(records.listRunRecords(path.join(dir, "missing")), []);
});

test("treats EPERM as alive and ESRCH as dead", () => {
  const fail = (code) => () => {
    throw Object.assign(new Error(code), { code });
  };
  assert.equal(records.isProcessAlive(1, fail("EPERM")), true);
  assert.equal(records.isProcessAlive(1, fail("ESRCH")), false);
  assert.equal(records.isProcessAlive(1, () => true), true);
});

test("open URLs use loopback for wildcard binds", () => {
  assert.equal(records.getOpenUrl("0.0.0.0", "8080"), "http://127.0.0.1:8080");
  assert.equal(records.getOpenUrl("::", "8080"), "http://[::1]:8080");
  assert.equal(records.getOpenUrl("::1", "8080"), "http://[::1]:8080");
  assert.equal(records.getOpenUrl("my-host", "8080"), "http://my-host:8080");
});

test("the tracker writes on ready and cleans up when the child exits", (t) => {
  const dir = path.join(tempDir(t), "run");
  const parent = new EventEmitter();
  parent.exit = (code) => parent.emit("exit", code);
  const child = new EventEmitter();
  child.kill = () => true;
  wireChildProcessLifecycle(child, parent, 10, () => {});

  const tracker = records.createRunRecordTracker({ dir, record: record(4100), parentProcess: parent });
  assert.ok(!fs.existsSync(dir), "nothing before the server is ready");
  tracker.markReady();
  tracker.markReady();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "4100.json"), "utf8")).pid, process.pid);

  child.emit("exit", 0, null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a failed record write warns once and does not throw", (t) => {
  const file = path.join(tempDir(t), "not-a-dir");
  fs.writeFileSync(file, "");
  const warnings = [];
  const parent = new EventEmitter();
  const tracker = records.createRunRecordTracker({
    dir: path.join(file, "run"),
    record: record(4200),
    parentProcess: parent,
    warn: (message) => warnings.push(message),
  });
  tracker.markReady();
  tracker.markReady();
  assert.equal(warnings.length, 1);
  assert.equal(parent.listenerCount("exit"), 0);

  const throwing = records.createRunRecordTracker({
    dir: () => {
      throw new Error("no home");
    },
    record: record(4300),
    parentProcess: parent,
    warn: (message) => warnings.push(message),
  });
  throwing.markReady();
  assert.equal(warnings.length, 2);
});

test("--port selection rule", () => {
  const two = [record(3000), record(4000)];
  assert.equal(records.selectRunRecord([], undefined).error, "No pi-web server is running.");
  assert.equal(records.selectRunRecord([record(3000)], undefined).record.port, 3000);
  assert.match(records.selectRunRecord(two, undefined).error, /Several[\s\S]*:3000[\s\S]*:4000[\s\S]*--port/);
  assert.equal(records.selectRunRecord(two, "4000").record.port, 4000);
  assert.match(records.selectRunRecord(two, "5000").error, /port 5000/);
});

test("status, stop and open use the injected run dir", async (t) => {
  const dir = tempDir(t);
  const out = [];
  const err = [];
  const deps = { runDir: dir, log: (m) => out.push(m), error: (m) => err.push(m), open: (url) => out.push(`open ${url}`) };

  assert.equal(await runCommand({ command: "status" }, deps), 0);
  assert.equal(out.pop(), "No pi-web server is running.");
  assert.equal(await runCommand({ command: "open" }, deps), 1);
  assert.equal(await runCommand({ command: "stop" }, deps), 1);

  records.writeRunRecord(dir, record(3000));
  assert.equal(await runCommand({ command: "status" }, deps), 0);
  assert.match(out.pop(), /http:\/\/127\.0\.0\.1:3000/);
  assert.equal(await runCommand({ command: "open" }, deps), 0);
  assert.equal(out.pop(), "open http://127.0.0.1:3000");
});

test("stop sends SIGTERM and waits for the launcher to exit", async () => {
  const signals = [];
  let alive = true;
  const code = await stopServer(record(3000, 42), {
    kill: (pid, signal) => {
      signals.push([pid, signal]);
    },
    isAlive: () => alive,
    wait: async () => {
      alive = false;
    },
    log: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(signals, [[42, "SIGTERM"]]);

  const stuck = await stopServer(record(3000, 42), {
    kill: () => {},
    isAlive: () => true,
    wait: async () => {},
    timeoutMs: 400,
    error: () => {},
  });
  assert.equal(stuck, 1);
});

test("install kind: global npm, npx cache or anything else", () => {
  const realpath = (p) => p.replace("/link-root", "/real-root");
  assert.equal(
    getInstallKind({ pkgDir: "/usr/lib/node_modules/@agegr/pi-web", npmRoot: "/usr/lib/node_modules", realpath }),
    "global",
  );
  assert.equal(
    getInstallKind({ pkgDir: "/real-root/@agegr/pi-web", npmRoot: "/link-root", realpath }),
    "global",
  );
  assert.equal(
    getInstallKind({ pkgDir: "/home/a/.npm/_npx/ab12/node_modules/@agegr/pi-web", npmRoot: "/usr/lib/node_modules", realpath }),
    "npx",
  );
  assert.equal(getInstallKind({ pkgDir: "/src/pi-web", npmRoot: "/usr/lib/node_modules", realpath }), "other");
  assert.equal(
    getInstallKind({ pkgDir: "/home/a/.pnpm-global/5/node_modules/@agegr/pi-web", npmRoot: "/usr/lib/node_modules", realpath }),
    "other",
  );
  assert.equal(getInstallKind({ pkgDir: "/usr/lib/node_modules/@agegr/pi-web", npmRoot: null, realpath }), "other");
});

test("update decisions", async () => {
  const base = {
    currentVersion: "0.11.0",
    pkgDir: "/usr/lib/node_modules/@agegr/pi-web",
    listRecords: () => [],
    formatRecord: (r) => r.url,
    fetchLatest: async () => "0.12.0",
    getNpmRoot: () => "/usr/lib/node_modules",
    realpath: (p) => p,
    log: () => {},
    error: () => {},
  };
  const installs = [];
  const install = (version) => {
    installs.push(version);
    return 0;
  };

  assert.equal(await runUpdate({ ...base, fetchLatest: async () => "0.11.0", install }), 0);
  assert.equal(await runUpdate({ ...base, check: true, install }), 0);
  assert.equal(await runUpdate({ ...base, fetchLatest: async () => { throw new Error("offline"); }, install }), 1);
  assert.equal(await runUpdate({ ...base, listRecords: () => [record(3000)], install }), 1);
  assert.equal(await runUpdate({ ...base, pkgDir: "/home/a/.npm/_npx/x/node_modules/@agegr/pi-web", install }), 1);
  assert.equal(await runUpdate({ ...base, pkgDir: "/src/pi-web", install }), 1);
  assert.deepEqual(installs, []);

  assert.equal(await runUpdate({ ...base, install }), 0);
  assert.deepEqual(installs, ["0.12.0"]);
  assert.equal(await runUpdate({ ...base, install: () => 7 }), 7);
  assert.equal(await runUpdate({ ...base, install: () => null }), 1);
});
