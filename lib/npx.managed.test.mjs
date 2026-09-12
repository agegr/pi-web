import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { runManagedProcess } from "./npx.ts";

const executionTimeout = 800;
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function stopped(pid) {
  for (let n = 0; n < 100 && alive(pid); n++) await delay(20);
  assert.equal(alive(pid), false, `Fixture process ${pid} must stop`);
}

test("managed process preserves argument boundaries and both output streams", async () => {
  const literal = "space ; & $(not-a-command) `literal`";
  const output = await runManagedProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1]);process.stderr.write('error stream')", literal], { timeout: executionTimeout });
  assert.equal(output.stdout, literal);
  assert.equal(output.stderr, "error stream");
});

test("managed process reports nonzero exits and spawn failures", async () => {
  await assert.rejects(runManagedProcess(process.execPath, ["-e", "process.stderr.write('failed');process.exit(7)"], { timeout: executionTimeout }), error => error.killed === false && error.stderr === "failed");
  await assert.rejects(runManagedProcess(join(tmpdir(), "pi-web-command-does-not-exist"), [], { timeout: executionTimeout }), error => error.code === "ENOENT");
});

test("managed process requires a finite positive termination budget", async () => {
  for (const timeout of [undefined, 0, -1, Infinity, NaN]) {
    await assert.rejects(runManagedProcess(process.execPath, ["-e", "process.exit(0)"], { timeout }), TypeError);
  }
});

test("timeout terminates a real wrapper and its descendant", async t => {
  // Allow real Node startup and taskkill scheduling under the full suite's concurrency.
  const processTreeTimeout = 4000;
  const root = mkdtempSync(join(tmpdir(), "pi-managed-process-"));
  const pidFile = join(root, "descendant.pid");
  let parentPid;
  let descendantPid;
  t.after(async () => {
    // An earlier assertion can fail before the normal PID read below.
    if (!descendantPid) {
      try { descendantPid = Number(readFileSync(pidFile, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    for (const pid of [parentPid, descendantPid]) if (pid && alive(pid)) process.kill(pid, "SIGKILL");
    if (parentPid) await stopped(parentPid);
    if (descendantPid) await stopped(descendantPid);
    rmSync(root, { recursive: true, force: true });
  });
  const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(runManagedProcess(process.execPath, ["-e", code], { timeout: processTreeTimeout, onSpawn(pid) { parentPid = pid; } }), error => error.killed === true && error.treeTerminated === true);
  descendantPid = Number(readFileSync(pidFile, "utf8"));
  await stopped(parentPid);
  await stopped(descendantPid);
});

test("failed Windows tree termination still settles within its budget", { skip: process.platform !== "win32" }, async t => {
  const root = mkdtempSync(join(tmpdir(), "pi-managed-no-taskkill-"));
  const previousPath = process.env.PATH;
  let parentPid;
  // Exercise an actual failed taskkill spawn without mocking the managed child.
  process.env.PATH = root;
  t.after(async () => {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (parentPid && alive(parentPid)) process.kill(parentPid, "SIGKILL");
    if (parentPid) await stopped(parentPid);
    rmSync(root, { recursive: true, force: true });
  });
  const pending = runManagedProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: executionTimeout, onSpawn(pid) { parentPid = pid; } });
  let watchdog;
  try {
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Managed process did not settle after termination budget")), executionTimeout * 5); })]), error => error.killed === true && error.treeTerminated === false);
  } finally { clearTimeout(watchdog); }
  assert.equal(alive(parentPid), true, "Unconfirmed termination must not claim the child stopped");
});

test("a hung Windows termination helper cannot keep the operation pending", { skip: process.platform !== "win32" }, async t => {
  let parentPid;
  let helperPid;
  const originalExecFile = childProcess.execFile;
  const replacement = t.mock.method(childProcess, "execFile", (command, args, opts, callback) => {
    if (command !== "taskkill") return originalExecFile(command, args, opts, callback);
    // Replace only the termination program: the helper is still a real process.
    // Deliberately omit execFile's timeout to exercise the independent deadline.
    const helper = childProcess.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, shell: false, stdio: "ignore" });
    helperPid = helper.pid;
    helper.on("close", () => callback(new Error("Fixture helper was terminated")));
    helper.on("error", callback);
    return helper;
  });
  syncBuiltinESMExports();
  t.after(async () => {
    replacement.mock.restore(); syncBuiltinESMExports();
    for (const pid of [parentPid, helperPid]) if (pid) { if (alive(pid)) process.kill(pid, "SIGKILL"); await stopped(pid); }
  });
  let watchdog;
  try {
    const pending = runManagedProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: executionTimeout, onSpawn(pid) { parentPid = pid; } });
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("Termination helper exceeded its budget")), executionTimeout * 5); })]), error => error.killed === true && error.treeTerminated === false);
    assert.ok(helperPid, "The actual termination helper must have started");
    await stopped(helperPid);
  } finally { clearTimeout(watchdog); }
});
