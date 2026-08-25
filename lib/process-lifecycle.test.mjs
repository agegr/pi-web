import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { wireChildProcessLifecycle } from "../bin/process-lifecycle.js";

function createProcesses() {
  const parent = new EventEmitter();
  const child = new EventEmitter();
  const forwardedSignals = [];
  const exitCodes = [];

  child.kill = (signal) => {
    forwardedSignals.push(signal);
    return true;
  };
  parent.exit = (code) => {
    exitCodes.push(code);
  };

  return { parent, child, forwardedSignals, exitCodes };
}

test("forwards the first shutdown signal and force-kills on repeated signals", () => {
  const { parent, child, forwardedSignals } = createProcesses();

  wireChildProcessLifecycle(child, parent);
  parent.emit("SIGTERM");
  parent.emit("SIGTERM");
  parent.emit("SIGINT");

  assert.deepEqual(forwardedSignals, ["SIGTERM", "SIGKILL", "SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
});

test("propagates a child exit code and clears its shutdown wiring", async () => {
  const { parent, child, forwardedSignals, exitCodes } = createProcesses();
  const existingSigtermListener = () => {};
  parent.on("SIGTERM", existingSigtermListener);

  wireChildProcessLifecycle(child, parent, 10);
  assert.equal(parent.listenerCount("SIGINT"), 1);
  assert.equal(parent.listenerCount("SIGTERM"), 2);

  parent.emit("SIGTERM");
  child.emit("exit", 23, null);
  await delay(20);

  assert.deepEqual(exitCodes, [23]);
  assert.equal(parent.listenerCount("SIGINT"), 0);
  assert.deepEqual(parent.listeners("SIGTERM"), [existingSigtermListener]);

  parent.emit("SIGTERM");
  assert.deepEqual(forwardedSignals, ["SIGTERM"]);
});

test("force-kills the child when graceful shutdown times out", async () => {
  const { parent, child, forwardedSignals } = createProcesses();

  wireChildProcessLifecycle(child, parent, 10);
  parent.emit("SIGINT");
  assert.deepEqual(forwardedSignals, ["SIGINT"]);

  await delay(20);

  assert.deepEqual(forwardedSignals, ["SIGINT", "SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
});

test("uses conventional exit statuses for known child signals", () => {
  for (const [signal, expectedExitCode] of [
    ["SIGTERM", 143],
    ["SIGKILL", 137],
  ]) {
    const { parent, child, exitCodes } = createProcesses();

    wireChildProcessLifecycle(child, parent);
    child.emit("exit", null, signal);

    assert.deepEqual(exitCodes, [expectedExitCode]);
  }
});
