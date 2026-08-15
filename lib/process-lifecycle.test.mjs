import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

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

test("forwards SIGINT and SIGTERM to the child until it exits", () => {
  const { parent, child, forwardedSignals } = createProcesses();

  wireChildProcessLifecycle(child, parent);
  parent.emit("SIGTERM");
  parent.emit("SIGTERM");
  parent.emit("SIGINT");

  assert.deepEqual(forwardedSignals, ["SIGTERM", "SIGTERM", "SIGINT"]);
});

test("propagates a child exit code and removes only its signal listeners", () => {
  const { parent, child, forwardedSignals, exitCodes } = createProcesses();
  const existingSigtermListener = () => {};
  parent.on("SIGTERM", existingSigtermListener);

  wireChildProcessLifecycle(child, parent);
  assert.equal(parent.listenerCount("SIGINT"), 1);
  assert.equal(parent.listenerCount("SIGTERM"), 2);

  child.emit("exit", 23, null);

  assert.deepEqual(exitCodes, [23]);
  assert.equal(parent.listenerCount("SIGINT"), 0);
  assert.deepEqual(parent.listeners("SIGTERM"), [existingSigtermListener]);

  parent.emit("SIGTERM");
  assert.deepEqual(forwardedSignals, []);
});

test("uses the conventional exit status when the child exits on a signal", () => {
  const { parent, child, exitCodes } = createProcesses();

  wireChildProcessLifecycle(child, parent);
  child.emit("exit", null, "SIGTERM");

  assert.deepEqual(exitCodes, [143]);
});
