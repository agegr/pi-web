import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  BackgroundTasksBridge,
  BG_REQUEST_CHANNEL,
  BG_RESPONSE_CHANNEL,
  BG_TERMINAL_CHANNEL,
  BG_REQUEST_SCHEMA,
  BG_RESPONSE_SCHEMA,
  BG_TERMINAL_SCHEMA,
  BG_LOGS_MAX_BYTES,
  clampBgLogBytes,
  bgOperationFailureStatus,
  createBackgroundTasksBridgeExtension,
  isBgTaskSnapshot,
} = await jiti.import("./background-tasks-bridge.ts");

/** Minimal fake EventBus recording emissions per channel. */
function createFakeBus() {
  const handlers = new Map();
  const emitted = [];
  const bus = {
    emit(channel, data) {
      emitted.push({ channel, data });
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
    on(channel, handler) {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => {
        handlers.set(channel, (handlers.get(channel) ?? []).filter((h) => h !== handler));
      };
    },
  };
  return { bus, emitted };
}

function makeSnapshot(overrides = {}) {
  return {
    id: "task-1",
    command: "npm test",
    status: "running",
    outputPath: "/tmp/task-1.output",
    cwd: "/tmp",
    startTime: 1,
    bytesWritten: 0,
    isAgent: false,
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
    ...overrides,
  };
}

/** Bus whose responder implements capabilities/status/logs/kill. */
function createPackageBus(options = {}) {
  const { bus, emitted } = createFakeBus();
  const tasks = options.tasks ?? [makeSnapshot()];
  const respond = (request, result) => bus.emit(BG_RESPONSE_CHANNEL, {
    schema_version: BG_RESPONSE_SCHEMA,
    request_id: request.request_id,
    operation: request.operation,
    ok: true,
    result,
  });
  bus.on(BG_REQUEST_CHANNEL, (data) => {
    if (data.operation === "capabilities") {
      respond(data, {
        api_version: 1,
        run: true,
        run_is_agent: true,
        run_completion_trigger: true,
        status: true,
        logs: true,
        logs_bounded: true,
        kill: true,
      });
      return;
    }
    if (data.operation === "status") {
      respond(data, { tasks });
      return;
    }
    if (data.operation === "logs") {
      if (options.logsError) {
        bus.emit(BG_RESPONSE_CHANNEL, {
          schema_version: BG_RESPONSE_SCHEMA,
          request_id: data.request_id,
          operation: data.operation,
          ok: false,
          error: options.logsError,
        });
        return;
      }
      respond(data, {
        task: tasks[0],
        path: tasks[0].outputPath,
        bytesRead: 4,
        truncated: true,
        tail: true,
        text: "tail",
      });
      return;
    }
    if (data.operation === "kill") {
      if (options.killError) {
        bus.emit(BG_RESPONSE_CHANNEL, {
          schema_version: BG_RESPONSE_SCHEMA,
          request_id: data.request_id,
          operation: data.operation,
          ok: false,
          error: options.killError,
        });
        return;
      }
      respond(data, { task: { ...tasks[0], status: "killed" }, message: "Killed background task task-1." });
    }
  });
  // Model the real package: a terminal frame updates the package's own task
  // list, so the bridge's derived status refresh observes the new state.
  bus.on(BG_TERMINAL_CHANNEL, (data) => {
    if (!data || typeof data !== "object" || data.schema_version !== BG_TERMINAL_SCHEMA) return;
    const task = data.task;
    if (!task || typeof task !== "object") return;
    const index = tasks.findIndex((existing) => existing.id === task.id);
    if (index === -1) tasks.push(task);
    else tasks[index] = task;
  });
  return { bus, emitted };
}

test("isBgTaskSnapshot accepts real snapshots and rejects malformed frames", () => {
  assert.equal(isBgTaskSnapshot(makeSnapshot()), true);
  assert.equal(isBgTaskSnapshot({ ...makeSnapshot(), status: "weird" }), false);
  assert.equal(isBgTaskSnapshot({ ...makeSnapshot(), id: "" }), false);
  assert.equal(isBgTaskSnapshot(null), false);
  assert.equal(isBgTaskSnapshot([makeSnapshot()]), false);
});

test("clampBgLogBytes clamps client input to the 50 KB runtime cap", () => {
  assert.equal(clampBgLogBytes(undefined), BG_LOGS_MAX_BYTES);
  assert.equal(clampBgLogBytes(0), BG_LOGS_MAX_BYTES);
  assert.equal(clampBgLogBytes(-5), BG_LOGS_MAX_BYTES);
  assert.equal(clampBgLogBytes(1024), 1024);
  assert.equal(clampBgLogBytes(10 * 1024 * 1024), BG_LOGS_MAX_BYTES);
  assert.equal(clampBgLogBytes(100.9), 100);
});

test("bgOperationFailureStatus maps package errors onto HTTP statuses", () => {
  assert.equal(bgOperationFailureStatus("Task not found: abc"), 404);
  assert.equal(bgOperationFailureStatus("pi-background-tasks EventBus service is unavailable before session_start"), 503);
  assert.equal(bgOperationFailureStatus("pi-background-tasks status request timed out"), 503);
  assert.equal(bgOperationFailureStatus("pi-background-tasks bridge is not attached (package absent)"), 503);
  assert.equal(bgOperationFailureStatus("something else went wrong"), 400);
});

test("unattached bridge reports unavailable without crashing", async (t) => {
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  assert.equal(bridge.isAttached(), false);

  const status = await bridge.listTasks();
  assert.equal(status.ok, false);
  assert.match(status.error, /not attached/);

  const logs = await bridge.logs("task-1");
  assert.equal(logs.ok, false);
  assert.match(logs.error, /not attached/);

  const kill = await bridge.kill("task-1");
  assert.equal(kill.ok, false);
  assert.match(kill.error, /not attached/);

  assert.equal(await bridge.probeCapabilities(), false);
  assert.equal(await bridge.refreshRunningState(), false);
});

test("bridge correlates requests and responses by request_id over the fake bus", async (t) => {
  const { bus, emitted } = createPackageBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);
  assert.equal(bridge.isAttached(), true);

  const status = await bridge.listTasks();
  assert.equal(status.ok, true);
  assert.deepEqual(status.result.map((task) => task.id), ["task-1"]);

  const request = emitted.find((entry) => entry.channel === BG_REQUEST_CHANNEL);
  assert.equal(request.data.schema_version, BG_REQUEST_SCHEMA);
  assert.equal(request.data.operation, "status");
  assert.equal(request.data.payload.taskId, undefined);
  assert.match(request.data.request_id, /^pi-web-/);

  // Empty payload object is forwarded verbatim (the package validates closed objects).
  assert.deepEqual(request.data.payload, {});
});

test("status success emits an update event through the sink and refreshes running tasks", async (t) => {
  const { bus } = createPackageBus({ tasks: [makeSnapshot()] });
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);
  const updates = [];
  bridge.setSink({ terminal: () => {}, update: (tasks) => updates.push(tasks) });

  await bridge.listTasks();
  assert.equal(updates.length, 1);
  assert.equal(bridge.hasRunningTasks(), true);

  // refreshRunningState short-circuits on the cached running snapshot.
  assert.equal(await bridge.refreshRunningState(), true);
  assert.equal(updates.length, 1);
});

test("terminal frames upsert the snapshot, notify the sink, and derive an update", async (t) => {
  const { bus } = createPackageBus({ tasks: [makeSnapshot()] });
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);
  const terminals = [];
  const updates = [];
  bridge.setSink({ terminal: (task) => terminals.push(task), update: (tasks) => updates.push(tasks) });

  await bridge.listTasks();

  bus.emit(BG_TERMINAL_CHANNEL, {
    schema_version: BG_TERMINAL_SCHEMA,
    task: makeSnapshot({ id: "task-1", status: "completed", endTime: 5, exitCode: 0 }),
  });
  // The derived refresh runs on the next macrotask.
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].status, "completed");
  assert.ok(updates.length >= 2);
  assert.equal(bridge.hasRunningTasks(), false);

  // Malformed / wrong-schema frames are ignored.
  bus.emit(BG_TERMINAL_CHANNEL, { task: makeSnapshot({ id: "task-9" }) });
  bus.emit(BG_TERMINAL_CHANNEL, { schema_version: "other", task: makeSnapshot({ id: "task-10" }) });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bridge.tasks.filter((task) => task.id === "task-9").length, 0);
  assert.equal(bridge.tasks.filter((task) => task.id === "task-10").length, 0);
});

test("logs and kill operations round-trip and surface package errors", async (t) => {
  const { bus } = createPackageBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);

  const logs = await bridge.logs("task-1", 999 * 1024, true);
  assert.equal(logs.ok, true);
  assert.equal(logs.result.text, "tail");
  assert.equal(logs.result.truncated, true);
  assert.equal(logs.result.bytesRead, 4);

  const kill = await bridge.kill("task-1");
  assert.equal(kill.ok, true);
  assert.equal(kill.result.task.status, "killed");
  assert.match(kill.result.message, /Killed background task/);

  const failing = createPackageBus({ logsError: "Task not found: nope", killError: "Task not found: nope" });
  const bridge2 = new BackgroundTasksBridge();
  t.after(() => bridge2.close());
  bridge2.attach(failing.bus);
  const failedLogs = await bridge2.logs("nope");
  assert.equal(failedLogs.ok, false);
  assert.match(failedLogs.error, /not found/);
  const failedKill = await bridge2.kill("nope");
  assert.equal(failedKill.ok, false);
  assert.match(failedKill.error, /not found/);
});

test("requests time out when no package answers", async (t) => {
  const { bus } = createFakeBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);

  const status = await bridge.listTasks();
  assert.equal(status.ok, false);
  assert.match(status.error, /timed out/);
  assert.equal(await bridge.probeCapabilities(), false);
});

test("capabilities probe latches a positive result", async (t) => {
  const { bus } = createPackageBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);
  assert.equal(await bridge.probeCapabilities(), true);
  assert.equal(await bridge.probeCapabilities(), true);
});

test("close rejects in-flight requests and stops the sink", async (t) => {
  const { bus } = createFakeBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(bus);
  bridge.setSink({ terminal: () => {}, update: () => {} });

  const pending = bridge.listTasks();
  bridge.close();
  const status = await pending;
  assert.equal(status.ok, false);
  assert.match(status.error, /bridge closed/);
  assert.equal(bridge.isAttached(), false);

  const after = await bridge.listTasks();
  assert.equal(after.ok, false);
  assert.match(after.error, /not attached/);
});

test("re-attaching to the same bus is a no-op; a new bus re-subscribes", async (t) => {
  const first = createPackageBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  bridge.attach(first.bus);
  bridge.attach(first.bus);

  const second = createPackageBus({ tasks: [makeSnapshot({ id: "task-2" })] });
  bridge.attach(second.bus);

  const status = await bridge.listTasks();
  assert.equal(status.ok, true);
  assert.deepEqual(status.result.map((task) => task.id), ["task-2"]);
});

test("the inline extension factory attaches the bridge to the extension event bus", (t) => {
  const extension = createBackgroundTasksBridgeExtension(new BackgroundTasksBridge());
  assert.equal(extension.name, "pi-web-background-tasks-bridge");
  assert.equal(extension.hidden, true);

  const { bus } = createPackageBus();
  const bridge = new BackgroundTasksBridge();
  t.after(() => bridge.close());
  const wired = createBackgroundTasksBridgeExtension(bridge);
  assert.equal(bridge.isAttached(), false);
  wired.factory({ events: bus });
  assert.equal(bridge.isAttached(), true);
});
