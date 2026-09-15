import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// `jiti` resolves this module's extensionless internal imports, which plain
// `node --experimental-strip-types` cannot (see lib/worktree.test.mjs).
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./shutdown-timer.ts");
}

const { SHUTDOWN_DEFAULT_SECONDS, ShutdownTimer } = await loadSubject();

const START_NOW = 1_700_000_000_000;

/** Controllable clock, recording exec fakes, and a throwaway state file path. */
function createHarness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-shutdown-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const statePath = path.join(root, "state.json");
  const calls = { start: [], cancel: 0 };
  let now = START_NOW;

  const timer = new ShutdownTimer({
    execStart: async (seconds) => {
      calls.start.push(seconds);
    },
    execCancel: async () => {
      calls.cancel += 1;
    },
    statePath,
    now: () => now,
  });

  return {
    root,
    statePath,
    timer,
    calls,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    writeState: (contents) => fs.writeFileSync(statePath, contents),
    readState: () => JSON.parse(fs.readFileSync(statePath, "utf8")),
  };
}

test("start arms the OS timer and reports the remaining time", async (t) => {
  const harness = createHarness(t);
  assert.equal(SHUTDOWN_DEFAULT_SECONDS, 60);

  await harness.timer.start();

  const deadline = START_NOW + SHUTDOWN_DEFAULT_SECONDS * 1000;
  assert.deepEqual(harness.timer.status(), {
    state: "counting",
    remainingSeconds: 60,
    deadline,
  });
  assert.deepEqual(harness.calls.start, [60]);
  assert.deepEqual(harness.readState(), { state: "counting", deadline });
});

test("start is idempotent while the countdown is running", async (t) => {
  const harness = createHarness(t);

  await harness.timer.start();
  await harness.timer.start();

  assert.deepEqual(harness.calls.start, [60]);
  assert.equal(harness.timer.status().state, "counting");
});

test("a failing OS command leaves the timer idle and clears the state file", async (t) => {
  const harness = createHarness(t);
  const failure = new Error("shutdown failed");
  const timer = new ShutdownTimer({
    execStart: async () => {
      throw failure;
    },
    execCancel: async () => {},
    statePath: harness.statePath,
    now: harness.now,
  });

  await assert.rejects(timer.start(), failure);

  assert.deepEqual(timer.status(), { state: "idle", remainingSeconds: null, deadline: null });
  assert.deepEqual(fs.readdirSync(harness.root), []);
});

test("cancel aborts the countdown after the OS command succeeds", async (t) => {
  const harness = createHarness(t);
  await harness.timer.start();

  await harness.timer.cancel();

  assert.equal(harness.calls.cancel, 1);
  assert.deepEqual(harness.timer.status(), { state: "idle", remainingSeconds: null, deadline: null });
  assert.equal(fs.existsSync(harness.statePath), false);
});

test("a failing cancel keeps the countdown active", async (t) => {
  const harness = createHarness(t);
  const failure = new Error("no shutdown in progress");
  let cancelCalls = 0;
  const timer = new ShutdownTimer({
    execStart: async () => {},
    execCancel: async () => {
      cancelCalls += 1;
      throw failure;
    },
    statePath: harness.statePath,
    now: harness.now,
  });
  await timer.start();

  await assert.rejects(timer.cancel(), failure);

  assert.equal(cancelCalls, 1);
  assert.equal(fs.existsSync(harness.statePath), true);
  assert.deepEqual(timer.status(), {
    state: "counting",
    remainingSeconds: 60,
    deadline: START_NOW + 60_000,
  });
});

test("status reports done once the deadline has passed", async (t) => {
  const harness = createHarness(t);
  await harness.timer.start();

  harness.advance(61_000);

  assert.deepEqual(harness.timer.status(), {
    state: "done",
    remainingSeconds: 0,
    deadline: START_NOW + 60_000,
  });
});

test("start after the deadline passes begins a new countdown", async (t) => {
  const harness = createHarness(t);
  await harness.timer.start();

  harness.advance(61_000);

  await harness.timer.start();

  const newDeadline = START_NOW + 61_000 + 60_000;
  assert.deepEqual(harness.calls.start, [60, 60]);
  assert.deepEqual(harness.timer.status(), {
    state: "counting",
    remainingSeconds: 60,
    deadline: newDeadline,
  });
  assert.deepEqual(harness.readState(), { state: "counting", deadline: newDeadline });
});

test("cancel after the deadline passes clears stale state without error", async (t) => {
  const harness = createHarness(t);
  await harness.timer.start();

  harness.advance(61_000);

  await harness.timer.cancel();

  assert.equal(harness.calls.cancel, 0);
  assert.deepEqual(harness.timer.status(), { state: "idle", remainingSeconds: null, deadline: null });
  assert.equal(fs.existsSync(harness.statePath), false);
});

test("restore re-arms a future persisted deadline", async (t) => {
  const harness = createHarness(t);
  const deadline = START_NOW + 30_000;
  harness.writeState(JSON.stringify({ state: "counting", deadline }));

  await harness.timer.restore();

  assert.deepEqual(harness.calls.start, [30]);
  assert.deepEqual(harness.timer.status(), {
    state: "counting",
    remainingSeconds: 30,
    deadline,
  });
});

test("restore drops a persisted deadline that already expired", async (t) => {
  const harness = createHarness(t);
  harness.writeState(JSON.stringify({ state: "counting", deadline: START_NOW - 1_000 }));

  await harness.timer.restore();

  assert.deepEqual(harness.calls.start, []);
  assert.deepEqual(harness.timer.status(), { state: "idle", remainingSeconds: null, deadline: null });
  assert.equal(fs.existsSync(harness.statePath), false);
});
