import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { createSubagentHandlers } = await jiti.import("./route.ts");
const { SubagentRpcClient } = await jiti.import("@/lib/subagent-rpc.ts");

function session(id, name, parentSessionId, overrides = {}) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    name,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: `first ${id}`,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...overrides,
  };
}

function sessionsFixture() {
  return [
    session("root", "Main task"),
    session("child", "subagent-worker-317e1ca0-1", "root"),
    session("grand", "subagent-reviewer-76fa6d64-6031-4824-8a88-1282c22d9afa-2", "child"),
  ];
}

/** Fake wrapper whose RPC client talks to a controllable fake bus. */
class FakeBridge {
  constructor() {
    this.handlers = new Map();
    this.requestLog = [];
    this.capabilities = { status: true, fleetStatus: { version: 1 }, runStatus: { version: 1 } };
    this.statusReply = null;
    this.controlError = null;
    this.controlResult = null;
  }

  on(channel, handler) {
    const list = this.handlers.get(channel) ?? [];
    list.push(handler);
    this.handlers.set(channel, list);
    return () => {
      this.handlers.set(channel, list.filter((candidate) => candidate !== handler));
    };
  }

  emit(channel, data) {
    this.requestLog.push({ channel, data });
    const reply = (payload) => {
      for (const handler of [...(this.handlers.get(`subagents:rpc:v1:reply:${data.requestId}`) ?? [])]) handler(payload);
    };
    if (channel !== "subagents:rpc:v1:request") return;
    if (data.method === "ping") {
      reply({ version: 1, requestId: data.requestId, method: "ping", success: true, data: { version: 1, capabilities: this.capabilities } });
    } else if (data.method === "status") {
      if (this.statusReply === "timeout") return; // never reply
      reply({ version: 1, requestId: data.requestId, method: "status", success: true, data: { runs: this.statusReply ?? { version: 1, entries: [], total: 0, omitted: 0 } } });
    } else if (this.controlError) {
      reply({ version: 1, requestId: data.requestId, method: data.method, success: false, error: this.controlError });
    } else {
      reply({ version: 1, requestId: data.requestId, method: data.method, success: true, data: this.controlResult ?? { ok: true } });
    }
  }
}

function makeDeps(bridge, { live = true, startFails = false, noFile = false, running = false, list = sessionsFixture() } = {}) {
  let alive = live;
  const wrapper = {
    isAlive: () => alive,
    isRunning: () => alive && running,
    getSubagentRpcClient: async () => new SubagentRpcClient({ events: bridge }),
  };
  return {
    listSessions: async () => list,
    getWrapper: () => (alive ? wrapper : undefined),
    startWrapper: async () => {
      if (startFails) throw new Error("startup failed");
      alive = true;
      return { session: wrapper };
    },
    resolveSessionPath: async () => (noFile ? null : `/tmp/root.jsonl`),
    bridge,
    kill: () => { alive = false; },
  };
}

function json(response) {
  return response.json();
}

test("GET unknown root returns 404", async () => {
  const { GET } = createSubagentHandlers(makeDeps(new FakeBridge()));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "missing" }) });
  assert.equal(response.status, 404);
});

test("GET a child id used as root returns 400", async () => {
  const { GET } = createSubagentHandlers(makeDeps(new FakeBridge()));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "child" }) });
  assert.equal(response.status, 400);
});

test("GET root without a session file returns durable tree with offline reason", async () => {
  const deps = makeDeps(new FakeBridge(), { live: false, noFile: true });
  const { GET } = createSubagentHandlers(deps);
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rootSessionId, "root");
  assert.equal(body.rpcAvailable, false);
  assert.equal(body.unavailableReason, "offline");
  assert.equal(body.nodes.length, 1);
  assert.equal(body.nodes[0].sessionId, "child");
  assert.equal(body.nodes[0].state, "inactive");
});

test("GET starts an absent root wrapper without a prompt", async () => {
  const deps = makeDeps(new FakeBridge(), { live: false });
  const { GET } = createSubagentHandlers(deps);
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, true);
  assert.equal(body.nodes[0].state, "inactive");
});

test("GET startup failure returns durable tree with offline reason", async () => {
  const deps = makeDeps(new FakeBridge(), { live: false, startFails: true });
  const { GET } = createSubagentHandlers(deps);
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).unavailableReason, "offline");
});

test("GET reuses a live root wrapper without starting a new one", async () => {
  let started = 0;
  const deps = makeDeps(new FakeBridge(), { live: true });
  deps.startWrapper = async () => { started += 1; throw new Error("must not start"); };
  const { GET } = createSubagentHandlers(deps);
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  assert.equal(started, 0);
  assert.equal((await json(response)).rpcAvailable, true);
});

test("GET missing runStatus capability returns durable tree with incompatible reason", async () => {
  const bridge = new FakeBridge();
  bridge.capabilities = { status: true, fleetStatus: { version: 1 } };
  const { GET } = createSubagentHandlers(makeDeps(bridge));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, false);
  assert.equal(body.unavailableReason, "incompatible");
  assert.equal(body.nodes[0].state, "inactive");
});

test("GET no ping reply returns durable tree with not-installed reason", async () => {
  const bridge = new FakeBridge();
  const originalEmit = bridge.emit.bind(bridge);
  bridge.emit = (channel, data) => {
    if (data.method === "ping") return; // never answer
    originalEmit(channel, data);
  };
  const { GET } = createSubagentHandlers(makeDeps(bridge));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.unavailableReason, "not-installed");
});

test("GET status timeout after negotiation returns 504 with durable fallback", async () => {
  const bridge = new FakeBridge();
  bridge.statusReply = "timeout";
  const { GET } = createSubagentHandlers(makeDeps(bridge));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 504);
  const body = await json(response);
  assert.equal(body.error, "subagent status timeout");
  assert.equal(body.busy, undefined);
  assert.equal(body.fallback.rootSessionId, "root");
  assert.equal(body.fallback.nodes.length, 1);
  assert.equal(body.fallback.nodes[0].sessionId, "child");
  assert.equal(body.fallback.nodes[0].children.length, 1);
});

test("GET status timeout while the parent is running marks the 504 as busy", async () => {
  const bridge = new FakeBridge();
  bridge.statusReply = "timeout";
  const { GET } = createSubagentHandlers(makeDeps(bridge, { running: true }));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 504);
  const body = await json(response);
  assert.equal(body.error, "subagent status timeout");
  assert.equal(body.busy, true);
  assert.equal(body.fallback.rootSessionId, "root");
});

test("GET compatible status returns the exact nested contract", async () => {
  const bridge = new FakeBridge();
  bridge.statusReply = {
    version: 1,
    entries: [
      { runId: "317e1ca0", index: 0, agent: "worker", state: "running", currentTool: "bash", startedAt: 1000, updatedAt: 1100 },
      { runId: "76fa6d64-6031-4824-8a88-1282c22d9afa", index: 1, agent: "reviewer", state: "running", startedAt: 1050, updatedAt: 1090 },
    ],
    total: 2,
    omitted: 0,
  };
  const { GET } = createSubagentHandlers(makeDeps(bridge));
  const response = await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.rpcAvailable, true);
  assert.equal(body.nodes.length, 1);
  const child = body.nodes.find((node) => node.sessionId === "child");
  assert.equal(child.state, "running");
  assert.equal(child.activity, "bash");
  assert.equal(child.canInterrupt, true);
  assert.equal(child.children.length, 1);
  assert.equal(child.children[0].sessionId, "grand");
  assert.equal(child.children[0].state, "running");
  assert.ok(body.polledAt > 0);
});

test("GET lists sessions through the dep so durable nodes are found", async () => {
  const calls = [];
  const deps = makeDeps(new FakeBridge());
  deps.listSessions = async () => { calls.push("list"); return sessionsFixture(); };
  const { GET } = createSubagentHandlers(deps);
  await GET(new Request("http://x/"), { params: Promise.resolve({ id: "root" }) });
  assert.deepEqual(calls, ["list"]);
});

test("POST rejects unsupported actions and blank messages", async () => {
  const { POST } = createSubagentHandlers(makeDeps(new FakeBridge()));
  const params = Promise.resolve({ id: "root" });

  let response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "child", action: "stop" }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "child", action: "steer" }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "child", action: "resume", message: "   " }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "child", action: "interrupt", message: "nope" }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ action: "interrupt" }) }), { params });
  assert.equal(response.status, 400);
});

test("POST rejects foreign, orphan, and placeholder child ids", async () => {
  const list = [
    session("root", "Main task"),
    session("other-root", "Other task"),
    session("foreign", "subagent-worker-33333333-0", "other-root"),
    session("orphan", "subagent-worker-44444444-1"),
  ];
  const { POST } = createSubagentHandlers(makeDeps(new FakeBridge(), { list }));
  const params = Promise.resolve({ id: "root" });

  let response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "foreign", action: "interrupt" }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "orphan", action: "interrupt" }) }), { params });
  assert.equal(response.status, 400);

  response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ childSessionId: "root", action: "interrupt" }) }), { params });
  assert.equal(response.status, 400);
});

test("POST derives runId/index server-side and ignores browser target fields", async () => {
  const bridge = new FakeBridge();
  const { POST } = createSubagentHandlers(makeDeps(bridge));
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "child", action: "steer", message: "keep going", runId: "evil", index: 99 }),
  }), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);

  const steer = bridge.requestLog.find((entry) => entry.data.method === "steer");
  assert.deepEqual(steer.data.params, { runId: "317e1ca0", index: 0, message: "keep going" });
});

test("POST routes controls through the root wrapper only", async () => {
  const bridge = new FakeBridge();
  let started = 0;
  const deps = makeDeps(bridge, { live: false });
  deps.startWrapper = async (id, filePath) => {
    started += 1;
    assert.equal(id, "root");
    assert.equal(filePath, "/tmp/root.jsonl");
    return { session: { isAlive: () => true, getSubagentRpcClient: async () => new SubagentRpcClient({ events: bridge }) } };
  };
  const { POST } = createSubagentHandlers(deps);
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "grand", action: "resume", message: "go on" }),
  }), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  assert.equal(started, 1);
  const resume = bridge.requestLog.find((entry) => entry.data.method === "resume");
  assert.deepEqual(resume.data.params, { runId: "76fa6d64-6031-4824-8a88-1282c22d9afa", index: 1, message: "go on" });
});

test("POST offline root returns 409", async () => {
  const deps = makeDeps(new FakeBridge(), { live: false, noFile: true });
  const { POST } = createSubagentHandlers(deps);
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "child", action: "interrupt" }),
  }), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 409);
});

test("POST maps rpc not_found and invalid_state to 409", async () => {
  for (const code of ["not_found", "invalid_state"]) {
    const bridge = new FakeBridge();
    bridge.controlError = { code, message: `${code} happened` };
    const { POST } = createSubagentHandlers(makeDeps(bridge));
    const response = await POST(new Request("http://x/", {
      method: "POST",
      body: JSON.stringify({ childSessionId: "child", action: "interrupt" }),
    }), { params: Promise.resolve({ id: "root" }) });
    assert.equal(response.status, 409);
    assert.equal((await json(response)).error, `${code} happened`);
  }
});

test("POST success returns the acknowledgement and a fresh tree when available", async () => {
  const bridge = new FakeBridge();
  bridge.statusReply = {
    version: 1,
    entries: [{ runId: "317e1ca0", index: 0, agent: "worker", state: "paused", startedAt: 1000, updatedAt: 1100 }],
    total: 1,
    omitted: 0,
  };
  const { POST } = createSubagentHandlers(makeDeps(bridge));
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "child", action: "interrupt" }),
  }), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(body.data.action, "interrupt");
  assert.equal(body.data.childSessionId, "child");
  assert.equal(body.data.control, undefined);
  assert.equal(body.data.tree.nodes[0].state, "paused");
});

test("POST success returns only the public DTO and never the raw rpc control result", async () => {
  const bridge = new FakeBridge();
  bridge.controlResult = {
    ok: true,
    details: {
      asyncDir: "/tmp/private-async",
      sessionFile: "/Users/kale/.pi/agent/sessions/private.jsonl",
      transcriptPath: "/tmp/private-transcript.jsonl",
      capabilityToken: "secret-token",
      controlInbox: "/tmp/control-inbox",
      intercomTarget: "private-target",
    },
  };
  bridge.statusReply = {
    version: 1,
    entries: [{ runId: "317e1ca0", index: 0, agent: "worker", state: "paused", startedAt: 1000, updatedAt: 1100 }],
    total: 1,
    omitted: 0,
  };
  const { POST } = createSubagentHandlers(makeDeps(bridge));
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "child", action: "interrupt" }),
  }), { params: Promise.resolve({ id: "root" }) });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(body.data.action, "interrupt");
  assert.equal(body.data.childSessionId, "child");
  assert.equal(body.data.tree?.rootSessionId, "root");
  assert.equal(body.data.control, undefined);
  assert.doesNotMatch(JSON.stringify(body), /asyncDir|sessionFile|transcriptPath|capabilityToken|controlInbox|intercomTarget/);
});

test("POST returns the changed tree snapshot after control and never the raw rpc result", async () => {
  const bridge = new FakeBridge();
  bridge.statusReply = {
    version: 1,
    entries: [{ runId: "317e1ca0", index: 0, agent: "worker", state: "running", startedAt: 1000, updatedAt: 1100 }],
    total: 1,
    omitted: 0,
  };
  const { GET, POST } = createSubagentHandlers(makeDeps(bridge));
  const params = Promise.resolve({ id: "root" });

  const before = await json(await GET(new Request("http://x/"), { params }));
  assert.equal(before.nodes[0].state, "running");

  bridge.statusReply = {
    version: 1,
    entries: [{ runId: "317e1ca0", index: 0, agent: "worker", state: "paused", startedAt: 1000, updatedAt: 1200 }],
    total: 1,
    omitted: 0,
  };
  const response = await POST(new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ childSessionId: "child", action: "interrupt" }),
  }), { params });
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.success, true);
  assert.equal(body.data.action, "interrupt");
  assert.equal(body.data.childSessionId, "child");
  assert.equal(body.data.tree.nodes[0].sessionId, "child");
  assert.equal(body.data.tree.nodes[0].state, "paused");
  assert.equal(body.data.control, undefined);
});

test("POST never exposes spawn, stop, retry, or bulk actions", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /"spawn"/);
  assert.doesNotMatch(source, /"stop"/);
  assert.doesNotMatch(source, /"retry"/);
  assert.match(source, /action !== "steer" && action !== "interrupt" && action !== "resume"/);
});
