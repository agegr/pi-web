import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  createSubagentRpcCapture,
  SubagentRpcClient,
  SubagentRpcError,
  SUBAGENT_RPC_TIMEOUT_MS,
  SUBAGENT_RPC_NEGATIVE_CACHE_TTL_MS,
} = await jiti.import("./subagent-rpc.ts");

const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";

class FakeBus {
  handlers = new Map();
  emitted = [];

  on(channel, handler) {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    return () => {
      const current = this.handlers.get(channel) ?? [];
      this.handlers.set(channel, current.filter((candidate) => candidate !== handler));
    };
  }

  emit(channel, data) {
    this.emitted.push({ channel, data });
    for (const handler of [...(this.handlers.get(channel) ?? [])]) handler(data);
  }

  reply(requestId, payload) {
    for (const handler of [...(this.handlers.get(`${REPLY_PREFIX}${requestId}`) ?? [])]) handler(payload);
  }

  requestCalls() {
    return this.emitted.filter((entry) => entry.channel === REQUEST_EVENT).map((entry) => entry.data);
  }
}

function captureWith(bus) {
  const { capture, extension } = createSubagentRpcCapture();
  extension.factory({ events: bus });
  return { capture, extension };
}

function pingData(overrides = {}) {
  return {
    version: 1,
    methods: ["ping", "status", "steer", "interrupt", "resume"],
    capabilities: { status: true, fleetStatus: { version: 1 }, runStatus: { version: 1 } },
    ...overrides,
  };
}

function runStatusData(entries = []) {
  return { version: 1, entries, total: entries.length, omitted: 0 };
}

async function replyToStatus(bus, payload = runStatusData()) {
  await new Promise((resolve) => setImmediate(resolve));
  const status = bus.requestCalls().filter((call) => call.method === "status").at(-1);
  assert.ok(status, "expected a status request");
  bus.reply(status.requestId, { version: 1, requestId: status.requestId, method: "status", success: true, data: { runs: payload } });
}

test("inline extension is hidden, named, and captures only the event bus", () => {
  const { capture, extension } = createSubagentRpcCapture();
  assert.equal(extension.name, "pi-web-subagent-rpc");
  assert.equal(extension.hidden, true);
  assert.equal(typeof extension.factory, "function");
  assert.equal(capture.events, null);
  const bus = new FakeBus();
  extension.factory({ events: bus });
  assert.equal(capture.events, bus);
});

test("reply subscription exists before the request is emitted", async () => {
  const bus = new FakeBus();
  const originalEmit = bus.emit.bind(bus);
  let subscribed = false;
  bus.emit = (channel, data) => {
    if (channel === REQUEST_EVENT) {
      subscribed = (bus.handlers.get(`${REPLY_PREFIX}${data.requestId}`)?.length ?? 0) > 0;
    }
    originalEmit(channel, data);
  };
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const pending = client.request("ping", "ping");
  assert.equal(subscribed, true);
  const request = bus.requestCalls()[0];
  bus.reply(request.requestId, { version: 1, requestId: request.requestId, method: "ping", success: true, data: pingData() });
  await pending;
  client.dispose();
});

test("replies with wrong version, request id, or method are ignored until timeout", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const bus = new FakeBus();
    const client = new SubagentRpcClient(captureWith(bus).capture);
    const pending = client.request("ping", "ping").catch((error) => error);
    const request = bus.requestCalls()[0];
    bus.reply(request.requestId, { version: 2, requestId: request.requestId, method: "ping", success: true, data: {} });
    bus.reply(request.requestId, { version: 1, requestId: "other", method: "ping", success: true, data: {} });
    bus.reply(request.requestId, { version: 1, requestId: request.requestId, method: "status", success: true, data: {} });
    mock.timers.tick(SUBAGENT_RPC_TIMEOUT_MS + 1);
    const error = await pending;
    assert.ok(error instanceof SubagentRpcError);
    assert.equal(error.code, "timeout");
    assert.equal(bus.handlers.get(`${REPLY_PREFIX}${request.requestId}`)?.length ?? 0, 0);
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("rpc error replies preserve code and message with the calling stage", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const pending = client.control("steer", { runId: "abc", index: 0, message: "go" }).catch((error) => error);
  const request = bus.requestCalls().find((call) => call.method === "ping");
  bus.reply(request.requestId, { version: 1, requestId: request.requestId, method: "ping", success: true, data: pingData() });
  await new Promise((resolve) => setImmediate(resolve));
  const steer = bus.requestCalls().find((call) => call.method === "steer");
  bus.reply(steer.requestId, {
    version: 1,
    requestId: steer.requestId,
    method: "steer",
    success: false,
    error: { code: "invalid_state", message: "Run is not running." },
  });
  const error = await pending;
  assert.ok(error instanceof SubagentRpcError);
  assert.equal(error.code, "invalid_state");
  assert.equal(error.message, "Run is not running.");
  assert.equal(error.stage, "control");
  client.dispose();
});

test("timeout unsubscribes the reply listener", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const bus = new FakeBus();
    const client = new SubagentRpcClient(captureWith(bus).capture);
    const pending = client.request("ping", "ping").catch((error) => error);
    const request = bus.requestCalls()[0];
    mock.timers.tick(SUBAGENT_RPC_TIMEOUT_MS + 1);
    const error = await pending;
    assert.equal(error.code, "timeout");
    assert.equal(bus.handlers.get(`${REPLY_PREFIX}${request.requestId}`)?.length ?? 0, 0);
    // A late reply must not resolve the already-settled request.
    bus.reply(request.requestId, { version: 1, requestId: request.requestId, method: "ping", success: true, data: pingData() });
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("getRunStatus requires runStatus v1 and never sends status otherwise", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const pending = client.getRunStatus();
  const ping = bus.requestCalls().find((call) => call.method === "ping");
  bus.reply(ping.requestId, {
    version: 1,
    requestId: ping.requestId,
    method: "ping",
    success: true,
    data: pingData({ capabilities: { status: true, fleetStatus: { version: 1 } } }),
  });
  const result = await pending;
  assert.equal(result, null);
  assert.equal(bus.requestCalls().some((call) => call.method === "status"), false);
  client.dispose();
});

test("compatible negotiation is cached for the client lifetime", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const first = client.getRunStatus();
  const ping1 = bus.requestCalls().find((call) => call.method === "ping");
  bus.reply(ping1.requestId, { version: 1, requestId: ping1.requestId, method: "ping", success: true, data: pingData() });
  await replyToStatus(bus);
  assert.deepEqual(await first, runStatusData());
  const second = client.getRunStatus();
  await replyToStatus(bus);
  assert.deepEqual(await second, runStatusData());
  assert.equal(bus.requestCalls().filter((call) => call.method === "ping").length, 1);
  client.dispose();
});

test("negative negotiation is cached for a bounded ttl then retried", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    const bus = new FakeBus();
    const client = new SubagentRpcClient(captureWith(bus).capture);

    const first = client.getRunStatus();
    const ping1 = bus.requestCalls().find((call) => call.method === "ping");
    bus.reply(ping1.requestId, {
      version: 1,
      requestId: ping1.requestId,
      method: "ping",
      success: true,
      data: pingData({ capabilities: { status: true } }),
    });
    assert.equal(await first, null);
    assert.equal(bus.requestCalls().filter((call) => call.method === "ping").length, 1);

    assert.equal(await client.getRunStatus(), null);
    assert.equal(bus.requestCalls().filter((call) => call.method === "ping").length, 1);

    mock.timers.tick(SUBAGENT_RPC_NEGATIVE_CACHE_TTL_MS + 1);
    const third = client.getRunStatus();
    assert.equal(bus.requestCalls().filter((call) => call.method === "ping").length, 2);
    const ping3 = bus.requestCalls().filter((call) => call.method === "ping").at(-1);
    bus.reply(ping3.requestId, { version: 1, requestId: ping3.requestId, method: "ping", success: true, data: pingData() });
    await replyToStatus(bus);
    assert.deepEqual(await third, runStatusData());
    client.dispose();
  } finally {
    mock.timers.reset();
  }
});

test("resetForReload clears capability, rejects pending requests, and unsubscribes", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const pending = client.getRunStatus();
  const ping = bus.requestCalls().find((call) => call.method === "ping");
  client.resetForReload();
  // The in-flight snapshot resolves as unavailable after the reload reset.
  assert.equal(await pending, null);
  assert.equal(bus.handlers.get(`${REPLY_PREFIX}${ping.requestId}`)?.length ?? 0, 0);
  // A direct transport request is rejected with the cancellation code.
  const direct = client.request("ping", "ping").catch((error) => error);
  const directPing = bus.requestCalls().filter((call) => call.method === "ping").at(-1);
  client.resetForReload();
  assert.equal((await direct).code, "cancelled");
  assert.equal(bus.handlers.get(`${REPLY_PREFIX}${directPing.requestId}`)?.length ?? 0, 0);
  // Capability state is cleared: the next call re-pings.
  const next = client.getRunStatus();
  const ping2 = bus.requestCalls().filter((call) => call.method === "ping").at(-1);
  assert.notEqual(ping2.requestId, ping.requestId);
  bus.reply(ping2.requestId, { version: 1, requestId: ping2.requestId, method: "ping", success: true, data: pingData() });
  await replyToStatus(bus);
  assert.deepEqual(await next, runStatusData());
  client.dispose();
});

test("dispose rejects pending and future requests permanently", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const pending = client.request("ping", "ping").catch((error) => error);
  client.dispose();
  const error = await pending;
  assert.equal(error.code, "disposed");
  await assert.rejects(client.request("ping", "ping"), (e) => e instanceof SubagentRpcError && e.code === "disposed");
  assert.equal(await client.getRunStatus(), null);
  await assert.rejects(client.control("steer", { runId: "x", message: "go" }), (e) => e instanceof SubagentRpcError && e.code === "unavailable");
});

test("getRunStatus validates and bounds untrusted run entries", async () => {
  const bus = new FakeBus();
  const client = new SubagentRpcClient(captureWith(bus).capture);
  const entries = [];
  for (let index = 0; index < 600; index += 1) {
    entries.push({ runId: `run-${index}`, index, agent: `agent-${index}`, state: "running", startedAt: index, updatedAt: index });
  }
  entries.push({ runId: "bad", agent: "x", state: "mystery", updatedAt: 1 });
  entries.push({ runId: "no-agent", state: "running", updatedAt: 1 });
  entries.push("garbage");
  const pending = client.getRunStatus();
  const ping = bus.requestCalls().find((call) => call.method === "ping");
  bus.reply(ping.requestId, { version: 1, requestId: ping.requestId, method: "ping", success: true, data: pingData() });
  await new Promise((resolve) => setImmediate(resolve));
  const status = bus.requestCalls().filter((call) => call.method === "status").at(-1);
  bus.reply(status.requestId, { version: 1, requestId: status.requestId, method: "status", success: true, data: { runs: runStatusData(entries) } });
  const runs = await pending;
  assert.equal(runs.entries.length, 512);
  assert.equal(runs.entries[0].runId, "run-0");
  assert.equal(runs.total, 603);
  client.dispose();
});

test("exposed client method surface excludes spawn and hard stop", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./subagent-rpc.ts", import.meta.url), "utf8");
  const methodDecl = source.slice(source.indexOf("export type SubagentRpcMethod"));
  assert.match(methodDecl, /"ping" \| "status" \| "steer" \| "interrupt" \| "resume"/);
  assert.doesNotMatch(methodDecl, /spawn|"stop"/);
});
