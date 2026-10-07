import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { setImmediate as nextMacrotask, setTimeout as delay } from "node:timers/promises";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

// The host's waits use unref'd timers, so they never keep a server process alive. Node 22's test
// runner cancels a test whose only pending work is such a timer; this keeps the loop running meanwhile.
const keepAlive = setInterval(() => {}, 1_000);
after(() => clearInterval(keepAlive));

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  McpHost,
  resolveMcpIdleMs,
  untrustedProjectServerEntries,
  watchConnection,
  watchTransport,
  withReachableExposure,
} = await jiti.import("./mcp-host.ts");
const { loadPiSdkInternals } = await jiti.import("./pi-sdk-internals.ts");
const { mcpConfigKey } = await jiti.import("./mcp-config-key.ts");
const { readMcpOverview } = await jiti.import("./mcp-config-read.ts");
const { clearMcpStatuses, mcpStatusCount, readMcpHostInactive, readMcpStatus, recordMcpStatus } = await jiti.import("./mcp-status.ts");

class FakeTransport {
  sent = [];
  messageListeners = new Set();
  closeListeners = new Set();
  /** What the next `send` rejects with, as a transport whose request failed. */
  sendError;
  async send(message) {
    this.sent.push(message);
    const error = this.sendError;
    this.sendError = undefined;
    if (error) throw error;
  }
  onMessage(listener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
  onClose(listener) {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  receive(message) {
    for (const listener of this.messageListeners) listener(message);
  }
  /** The client closes it. */
  close() {
    this.drop();
  }
  /** It closes by itself, as a stdio transport does when its server exits. */
  drop() {
    for (const listener of this.closeListeners) listener();
  }
  /** The client side of a handshake: initialize answered, then initialized sent. */
  async handshake(capabilities) {
    this.receive({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-06-18", capabilities } });
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
}

test("PI_WEB_MCP_IDLE_MS defaults to 10 minutes and 0 keeps servers connected", (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(resolveMcpIdleMs(undefined), 600_000);
  assert.equal(resolveMcpIdleMs(" "), 600_000);
  assert.equal(resolveMcpIdleMs("0"), 0);
  assert.equal(resolveMcpIdleMs("1500"), 1500);
  assert.equal(resolveMcpIdleMs("soon"), 600_000);
  assert.equal(resolveMcpIdleMs("-1"), 600_000);
});

test("without a codemode sandbox, script-only tools are offered through tool_search", () => {
  // The config is loadMcpConfig()'s: its validator already read `codemode-deferred` as `codemode`.
  const config = { command: "srv", toolExposure: { a: "hidden", b: "direct", c: "codemode" } };
  assert.equal(withReachableExposure(config, true), config);
  assert.deepEqual(withReachableExposure(config, false), {
    command: "srv",
    exposure: "deferred",
    toolExposure: { a: "hidden", b: "direct", c: "deferred" },
  });
  assert.deepEqual(withReachableExposure({ url: "https://x", exposure: "direct" }, false), { url: "https://x", exposure: "direct" });
  assert.deepEqual(withReachableExposure({ url: "https://x", exposure: "hidden" }, false), { url: "https://x", exposure: "hidden" });
});

function watched(transport) {
  const outcomes = [];
  watchConnection(transport, (outcome) => outcomes.push(outcome));
  return outcomes;
}

test("a connection is ready once its tool lists are answered, every page of them", async () => {
  const transport = new FakeTransport();
  const outcomes = watched(transport);
  await transport.handshake({ tools: {} });
  await nextMacrotask();
  assert.deepEqual(outcomes, [], "tools are expected but not listed yet");

  await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  transport.receive({ jsonrpc: "2.0", id: 1, result: { tools: [], nextCursor: "2" } });
  // The client asks for the next page in the microtasks that follow the answer.
  await Promise.resolve();
  await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "2" } });
  await nextMacrotask();
  assert.deepEqual(outcomes, []);

  // A server-initiated request is not an answer.
  transport.receive({ jsonrpc: "2.0", id: 7, method: "roots/list" });
  transport.receive({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
  await nextMacrotask();
  assert.deepEqual(outcomes, ["ready"]);
  transport.close();
  assert.deepEqual(outcomes, ["ready"]);
});

test("a server without lists is ready after the handshake, and a closed one is not", async () => {
  const bare = new FakeTransport();
  const bareOutcomes = watched(bare);
  await bare.handshake({ prompts: {} });
  await nextMacrotask();
  assert.deepEqual(bareOutcomes, ["ready"]);

  const closed = new FakeTransport();
  const closedOutcomes = watched(closed);
  closed.close();
  await closed.handshake({});
  await nextMacrotask();
  assert.deepEqual(closedOutcomes, ["closed"]);
});

function named(name, message = name) {
  const error = new Error(message);
  error.name = name;
  return error;
}

test("a transport is followed for its whole life, with what made it fail", async () => {
  // A spawn failure: start rejects, then the transport closes.
  const spawnFailed = new FakeTransport();
  spawnFailed.start = async () => {
    throw new Error("spawn lint-mcp ENOENT");
  };
  const spawnEvents = [];
  watchTransport(spawnFailed, false, (event) => spawnEvents.push(event));
  await assert.rejects(spawnFailed.start(), /ENOENT/);
  spawnFailed.close();
  assert.deepEqual(spawnEvents, [{ type: "failed", authRequired: false, error: new Error("spawn lint-mcp ENOENT") }]);

  // The server's error answer to initialize, and the stderr a stdio server wrote; a request on the
  // closed transport says nothing more.
  const refused = new FakeTransport();
  refused.stderr = "  config missing\n";
  const refusedEvents = [];
  watchTransport(refused, false, (event) => refusedEvents.push(event));
  await refused.send({ jsonrpc: "2.0", id: 0, method: "initialize" });
  refused.receive({ jsonrpc: "2.0", id: 0, error: { code: -32603, message: "unsupported protocol" } });
  refused.sendError = named("McpConnectionClosedError", "MCP connection closed");
  await assert.rejects(refused.send({ jsonrpc: "2.0", method: "notifications/cancelled" }));
  refused.drop();
  assert.deepEqual(refusedEvents, [{ type: "failed", authRequired: false, error: "unsupported protocol", stderr: "config missing" }]);

  // A sign-in: an OAuth server's 401 too, but not a 401 of a server with its own Authorization header.
  for (const [error, usesOAuth, authRequired] of [
    [named("McpOAuthAuthorizationRequiredError"), false, true],
    [named("McpAuthRequiredError"), true, true],
    [named("McpAuthRequiredError"), false, false],
  ]) {
    const transport = new FakeTransport();
    const events = [];
    watchTransport(transport, usesOAuth, (event) => events.push(event));
    transport.sendError = error;
    await assert.rejects(transport.send({ jsonrpc: "2.0", id: 0, method: "initialize" }));
    transport.close();
    assert.equal(events[0].authRequired, authRequired, `${error.name}, OAuth ${usesOAuth}`);
    assert.equal(events[0].error === undefined, authRequired, "a sign-in is no failure");
  }

  // Ready, then dropped by itself; or ready, then closed by the client.
  for (const [end, dropped] of [["drop", true], ["close", false]]) {
    const transport = new FakeTransport();
    const events = [];
    watchTransport(transport, false, (event) => events.push(event));
    await transport.handshake({});
    await nextMacrotask();
    transport[end]();
    assert.deepEqual(events, [{ type: "ready" }, { type: "closed", dropped, authRequired: false }], end);
  }
});

// ---------------------------------------------------------------------------

/** The server names an untrusted project's `.pi/mcp.json` declares, as the host reads them. */
const untrustedProjectServerNames = (cwd) => untrustedProjectServerEntries(cwd).map(([name]) => name);

const MCP_COMMAND = { name: "mcp", sourceInfo: { path: "builtin:mcp" } };

function entry(name, config, scope = "global") {
  return { name, config, source: `/agent/${scope}.json`, scope };
}

/**
 * A pi whose MCP extension connects what is registered through the host's
 * transport factory, when the test says so.
 */
function setup({ servers = [], commands = [MCP_COMMAND], codemodeAvailable = true, projectTrusted = true, pi: piOverrides = {}, ...options } = {}) {
  const handlers = new Map();
  const log = [];
  const registered = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getCommands: () => commands,
    registerMcpServer(name, config) {
      if (name === "taken") throw new Error(`MCP server "taken" is registered by /ext/other.ts`);
      registered.set(name, config);
      log.push(`register ${name}`);
    },
    unregisterMcpServer(name) {
      registered.delete(name);
      log.push(`unregister ${name}`);
    },
    ...piOverrides,
  };
  const config = { servers };
  const loads = [];
  const trustReads = [];
  const host = new McpHost({
    agentDir: "/agent",
    internals: {
      loadMcpConfig: (loadOptions) => {
        loads.push(loadOptions);
        return { servers: config.servers, errors: [] };
      },
    },
    codemodeAvailable: () => codemodeAvailable,
    mayReadProjectConfig: (cwd) => {
      trustReads.push(cwd);
      return projectTrusted;
    },
    promptWaitMs: 5_000,
    idleMs: 0,
    ...options,
  });
  host.extension().factory(pi);
  // The wrapper's snapshot; the host must not read it.
  const ctx = {
    cwd: "/project",
    isProjectTrusted: () => {
      throw new Error("the host read the wrapper's trust snapshot");
    },
    isIdle: () => true,
    sessionManager: { getSessionId: () => "session-1" },
  };
  const emit = (event) => {
    for (const handler of handlers.get(event) ?? []) handler({ type: event }, ctx);
  };
  emit("session_start");
  const transports = new Map();
  const factory = host.wrapTransportFactory((serverEntry) => {
    if (serverEntry.config.command === "broken") throw new Error("env \"TOKEN\" references PI_WEB_PASSWORD");
    const token = serverEntry.config.env?.TOKEN;
    if (token?.startsWith("!")) {
      throw new Error(`Failed to resolve MCP server "${serverEntry.name}" env "TOKEN" from shell command: ${token.slice(1)}`);
    }
    const transport = new FakeTransport();
    transports.set(serverEntry.name, transport);
    return transport;
  });
  /**
   * What the MCP extension does for a registered server: open its transport,
   * the first time and at every reconnect. An OAuth server's connection
   * passes an auth provider.
   */
  const connect = (name, authProvider) =>
    factory({ name, config: registered.get(name), source: "<inline:pi-web-mcp-host>", scope: "extension" }, "/project", authProvider);
  return { host, log, registered, config, loads, trustReads, emit, ctx, transports, connect, factory };
}

test("nothing is registered until a prompt, then only the servers that may connect", async () => {
  const { host, log, registered } = setup({
    servers: [
      entry("docs", { url: "https://docs.example/mcp" }),
      entry("off", { command: "srv", enabled: false }),
      entry("repo", { command: "repo-srv" }, "project"),
      entry("taken", { command: "srv" }),
    ],
    // Nothing connects here, so the prompt would wait the whole time.
    promptWaitMs: 10,
  });
  assert.deepEqual(log, []);

  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs", "register repo"]);
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "connecting" },
    { name: "repo", scope: "project", state: "connecting" },
    { name: "taken", scope: "global", state: "not-registered", error: "MCP server \"taken\" is registered by /ext/other.ts" },
  ]);
});

test("project entries follow the project's trust, which the SDK applies when it reads mcp.json", async () => {
  const trusted = setup({ promptWaitMs: 10 });
  await trusted.host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(trusted.loads, [{ agentDir: "/agent", cwd: "/project", projectTrusted: true }]);
  assert.deepEqual(trusted.trustReads, ["/project"]);

  const untrusted = setup({ projectTrusted: false, promptWaitMs: 10 });
  await untrusted.host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(untrusted.loads, [{ agentDir: "/agent", cwd: "/project", projectTrusted: false }]);
  // Asked again on every sync, never cached.
  await untrusted.host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(untrusted.trustReads, ["/project", "/project"]);
});

test("a prompt waits for servers with direct tools still connecting, until they are ready", async () => {
  const { host, connect, transports } = setup({ servers: [entry("docs", { command: "docs-srv", toolExposure: { search: "direct" } })] });
  let prepared = false;
  const preparing = host.prepareForPrompt(new AbortController().signal).then(() => {
    prepared = true;
  });
  await delay(10);
  connect("docs");
  await delay(10);
  assert.equal(prepared, false);
  await transports.get("docs").handshake({});
  await preparing;
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "ready" }]);
});

test("Stop ends the wait at once", async () => {
  const { host, connect } = setup({ servers: [entry("slow", { command: "slow-srv" })] });
  const controller = new AbortController();
  const started = Date.now();
  const preparing = host.prepareForPrompt(controller.signal);
  await delay(10);
  connect("slow");
  controller.abort();
  await preparing;
  assert.ok(Date.now() - started < 1_000);
});

test("a prompt does not wait for servers whose tools reach the model through Code mode or tool search", async () => {
  const { host, connect, transports } = setup({
    servers: [entry("docs", { command: "docs-srv" }), entry("search", { command: "search-srv", exposure: "deferred" })],
    promptWaitMs: 60_000,
  });
  const started = Date.now();
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  connect("search");
  await preparing;
  assert.ok(Date.now() - started < 1_000, "the SDK's extension waits for them when a script or tool_search needs them");
  assert.deepEqual(host.serverStates().map((server) => server.state), ["connecting", "connecting"]);
  await transports.get("docs").handshake({});
  await nextMacrotask();
  assert.equal(host.serverStates()[0].state, "ready");
});

test("a server that outlasted one wait does not hold up the next prompt", async () => {
  const { host, connect } = setup({ servers: [entry("slow", { command: "slow-srv", exposure: "direct" })], promptWaitMs: 40 });
  const first = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("slow");
  const firstStarted = Date.now();
  await first;
  assert.ok(Date.now() - firstStarted >= 25);
  const secondStarted = Date.now();
  await host.prepareForPrompt(new AbortController().signal);
  assert.ok(Date.now() - secondStarted < 25);
});

test("a server whose transport cannot be built fails without a wait", async () => {
  const { host, connect } = setup({ servers: [entry("leaky", { command: "broken" })] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.throws(() => connect("leaky"), /PI_WEB_PASSWORD/);
  await preparing;
  assert.deepEqual(host.serverStates(), [{
    name: "leaky",
    scope: "global",
    state: "failed",
    error: "env \"TOKEN\" references PI_WEB_PASSWORD",
  }]);
});

test("a changed entry is replaced only once the extension has opened its connection", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "v1" })] });
  // Registered, but the extension has not opened a connection yet.
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  config.servers = [entry("docs", { command: "v2" })];
  const second = host.prepareForPrompt(new AbortController().signal);
  await delay(30);
  // Unregistering now would leave the extension nothing to close; it would connect v1 anyway.
  assert.deepEqual(log, ["register docs"]);
  connect("docs");
  await transports.get("docs").handshake({});
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
  connect("docs");
  await transports.get("docs").handshake({});
  await second;

  config.servers = [];
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs", "unregister docs"]);
  assert.deepEqual(host.serverStates(), []);
});

test("a connection the extension opens after the host gave up waiting to unregister it gets no transport", async () => {
  const { host, log, config, connect, factory, transports } = setup({
    servers: [entry("docs", { command: "v1" })],
    promptWaitMs: 10,
    replaceWaitMs: 20,
  });
  await host.prepareForPrompt(new AbortController().signal);
  // The extension has not opened docs' connection yet (still loading its runtime, say).
  config.servers = [];
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
  // The extension closed nothing, as it had nothing to close; the connection it assigns now
  // is out of its reach, so its transport is refused and nothing starts.
  const late = { name: "docs", config: { command: "v1" }, source: "<inline:pi-web-mcp-host>", scope: "extension" };
  assert.throws(() => factory(late, "/project"), /MCP server "docs" was removed before it connected, so Pi Web did not start it/);
  assert.equal(transports.has("docs"), false);
  assert.deepEqual(host.serverStates(), []);

  // Registered again, with the same content: its own connection is followed as usual.
  config.servers = [entry("docs", { command: "v1" })];
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "ready" }]);
});

test("the built-in /mcp registers the servers without waiting for them to connect", async () => {
  const { host, log } = setup({ servers: [entry("docs", { command: "srv" })], promptWaitMs: 60_000 });
  const started = Date.now();
  await host.prepareForPrompt(new AbortController().signal, { wait: false });
  assert.ok(Date.now() - started < 1_000, "nothing waited for docs to connect");
  assert.deepEqual(log, ["register docs"]);
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "connecting" }]);
});

test("an unchanged entry is left connected, however its file orders the keys", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "srv", args: ["-v"] })] });
  const first = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await first;
  config.servers = [entry("docs", { args: ["-v"], command: "srv" })];
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs"]);
});

test("servers are registered with the exposure codemode can serve", async () => {
  const { host, registered } = setup({ servers: [entry("docs", { command: "srv" })], codemodeAvailable: false });
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.deepEqual(registered.get("docs"), { command: "srv", exposure: "deferred" });
});

test("the host stays out of the way when another extension owns /mcp", async () => {
  const { host, log } = setup({
    servers: [entry("docs", { command: "srv" })],
    commands: [{ name: "mcp", sourceInfo: { path: "/ext/other-mcp.ts" } }],
  });
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, []);
});

test("an idle host unregisters its servers, but not while a run is going", async () => {
  const { host, log, emit, ctx, connect, transports } = setup({ servers: [entry("docs", { command: "srv" })], idleMs: 20 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  emit("agent_start");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a run keeps its servers");

  let idle = false;
  ctx.isIdle = () => idle;
  emit("agent_end");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a run pi still reports busy keeps its servers");

  idle = true;
  emit("agent_end");
  emit("agent_start");
  await delay(50);
  assert.deepEqual(log, ["register docs"], "a new run cancels the idle timer");

  emit("agent_end");
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
  // The next prompt connects them again.
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
});

test("servers registered for a prompt that starts no run still idle out", async () => {
  // Stop during the wait, a slash command, a rejected preflight: no agent_end follows.
  const { host, log, connect, transports } = setup({ servers: [entry("docs", { command: "srv" })], idleMs: 20 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
});

test("a sync that finishes after Stop gave up on it still lets its servers idle out", async () => {
  const { host, log, config, connect, transports } = setup({ servers: [entry("docs", { command: "v1" })], idleMs: 20 });
  // v1 is registered, but the extension has not opened its connection yet...
  void host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  // ...so replacing it waits, and Stop ends the prompt while the sync is still queued.
  config.servers = [entry("docs", { command: "v2" })];
  const controller = new AbortController();
  const stopped = host.prepareForPrompt(controller.signal);
  await delay(5);
  controller.abort();
  await stopped;
  assert.deepEqual(log, ["register docs"]);

  connect("docs");
  await transports.get("docs").handshake({});
  await delay(5);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs"]);
  // The extension opens v2's connection in turn; the idle timer then releases it.
  connect("docs");
  await transports.get("docs").handshake({});
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs", "register docs", "unregister docs"]);
});

test("the idle timer does not run while a prompt waits for its servers", async () => {
  const { host, log, connect, transports } = setup({ servers: [entry("docs", { command: "srv", exposure: "direct" })], idleMs: 20 });
  let prepared = false;
  const preparing = host.prepareForPrompt(new AbortController().signal).then(() => {
    prepared = true;
  });
  await delay(5);
  connect("docs");
  await delay(60);
  assert.equal(prepared, false);
  assert.deepEqual(log, ["register docs"]);
  await transports.get("docs").handshake({});
  await preparing;
  await delay(50);
  assert.deepEqual(log, ["register docs", "unregister docs"]);
});

// ---------------------------------------------------------------------------
// What sessions report to Settings › MCP (lib/mcp-status.ts)
// ---------------------------------------------------------------------------

/** The status a session recorded for a global entry of the fake `setup()`, read as Settings reads it. */
function sessionStatus(name, config, scope = "global") {
  return readMcpStatus({ scope, sourcePath: `/agent/${scope}.json`, name }, mcpConfigKey(config));
}

function oauthError(name) {
  const error = new Error(name === "McpAuthRequiredError" ? "MCP server requires authentication" : "MCP OAuth authorization requires user interaction");
  error.name = name;
  return error;
}

test("a session records each server's state for Settings, keyed by the entry as its file holds it", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const config = { command: "srv", args: ["-v"] };
  const { host, connect, transports } = setup({ servers: [entry("docs", config)] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  const connecting = sessionStatus("docs", config);
  assert.equal(connecting.state, "connecting");
  assert.deepEqual(
    { origin: connecting.origin, sessionId: connecting.sessionId, cwd: connecting.cwd },
    { origin: "session", sessionId: "session-1", cwd: "/project" },
  );
  assert.equal(typeof connecting.updatedAt, "number");
  await transports.get("docs").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  assert.equal(sessionStatus("docs", config).state, "connected");
  // The key is the entry's own content, whatever the host registered (here the same), and only it.
  assert.equal(sessionStatus("docs", { command: "srv" }), undefined);
});

test("a server that asks for a sign-in reads needs-auth, and connected once a reconnect after the sign-in is ready", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const config = { url: "https://docs.example/mcp" };
  const { host, connect, transports } = setup({ servers: [entry("docs", config)] });
  const authProvider = { token: async () => undefined };
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs", authProvider);
  const first = transports.get("docs");
  // The auth provider gives up on the 401 (no stored token), the request fails, and the client closes.
  first.sendError = oauthError("McpOAuthAuthorizationRequiredError");
  await assert.rejects(first.send({ jsonrpc: "2.0", id: 0, method: "initialize" }), { name: "McpOAuthAuthorizationRequiredError" });
  first.close();
  await preparing;
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "needs-auth" }]);
  const asked = sessionStatus("docs", config);
  assert.equal(asked.state, "needs-auth");
  assert.equal(asked.error, undefined, "a sign-in is no error");

  // Tokens were stored elsewhere (Settings, `pi mcp login`); the extension reconnects at the next turn.
  connect("docs", authProvider);
  const second = transports.get("docs");
  assert.notEqual(second, first);
  assert.equal(sessionStatus("docs", config).state, "connecting");
  await second.handshake({});
  await nextMacrotask();
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "ready" }]);
  assert.equal(sessionStatus("docs", config).state, "connected");
  // An old transport closing late says nothing about the server any more.
  first.drop();
  assert.equal(sessionStatus("docs", config).state, "connected");

  // A later request asks for a sign-in again (the grant was revoked): the SDK drops the client to wait for one.
  second.sendError = oauthError("McpOAuthAuthorizationRequiredError");
  await assert.rejects(second.send({ jsonrpc: "2.0", id: 5, method: "tools/call" }));
  second.close();
  assert.equal(sessionStatus("docs", config).state, "needs-auth");
});

test("a 401 is a sign-in only for a server that signs in with OAuth", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const config = { url: "https://docs.example/mcp", headers: { Authorization: "Bearer ${DOCS_TOKEN}" } };
  const { host, connect, transports } = setup({ servers: [entry("docs", config)] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  // An Authorization header: the connection passes no auth provider, and a 401 is a failure.
  connect("docs");
  const transport = transports.get("docs");
  transport.sendError = oauthError("McpAuthRequiredError");
  await assert.rejects(transport.send({ jsonrpc: "2.0", id: 0, method: "initialize" }));
  transport.close();
  await preparing;
  assert.deepEqual(host.serverStates(), [{ name: "docs", scope: "global", state: "failed", error: "MCP server requires authentication" }]);
  assert.equal(sessionStatus("docs", config).error, "MCP server requires authentication");
});

test("a connection that drops after it was ready reads disconnected with its stderr, and one the client closed does not", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const lint = { command: "lint-srv" };
  const docs = { command: "docs-srv" };
  const { host, connect, transports } = setup({ servers: [entry("docs", docs), entry("lint", lint)] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  connect("lint");
  await transports.get("docs").handshake({});
  await transports.get("lint").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();

  const dropped = transports.get("lint");
  dropped.stderr = "starting\npanic: out of memory\n";
  dropped.drop();
  const lintState = host.serverStates().find((server) => server.name === "lint");
  assert.deepEqual(lintState, { name: "lint", scope: "global", state: "disconnected", stderr: "starting\npanic: out of memory" });
  const status = sessionStatus("lint", lint);
  assert.equal(status.state, "disconnected");
  assert.equal(status.stderr, "starting\npanic: out of memory");

  // Closed by the client (a reconnect, the session ending): not a drop.
  transports.get("docs").close();
  assert.equal(sessionStatus("docs", docs).state, "connected");
});

test("what a session records is masked, and a transport that could not be built is recorded too", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const secret = { command: "srv", env: { TOKEN: "!pass show work/very-secret-token" } };
  const { host, connect } = setup({ servers: [entry("secret", secret)], promptWaitMs: 10 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  assert.throws(() => connect("secret"), /from shell command/);
  await preparing;
  const status = sessionStatus("secret", secret);
  assert.equal(status.state, "failed");
  assert.match(status.error, /env "TOKEN" from shell command: •••$/);
  assert.ok(!status.error.includes("very-secret-token"), status.error);
});

test("a transport failure's message is masked before it is recorded", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const config = { command: "srv", env: { API_TOKEN: "literal-env-secret-value" } };
  const { host, connect, transports } = setup({ servers: [entry("docs", config)], promptWaitMs: 10 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  const transport = transports.get("docs");
  await transport.send({ jsonrpc: "2.0", id: 0, method: "initialize" });
  // The server echoes the key it was given in its error, and the connection closes.
  transport.receive({ jsonrpc: "2.0", id: 0, error: { code: -32603, message: "bad key literal-env-secret-value" } });
  transport.drop();
  await preparing;
  const status = sessionStatus("docs", config);
  assert.equal(status.state, "failed");
  assert.ok(!status.error.includes("literal-env-secret-value"), status.error);
  assert.match(status.error, /bad key •••/);
});

test("a server let go while it connects leaves no connecting record, and a closed session no drops", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const docs = { command: "docs-srv" };
  const lint = { command: "lint-srv" };
  const { host, config, connect, transports, emit } = setup({ servers: [entry("docs", docs), entry("lint", lint)], promptWaitMs: 10 });
  await host.prepareForPrompt(new AbortController().signal);
  connect("docs");
  connect("lint");
  await transports.get("lint").handshake({});
  await nextMacrotask();
  assert.equal(sessionStatus("docs", docs).state, "connecting");

  // Removed from the file: nothing will ever finish its "connecting".
  config.servers = [entry("lint", lint)];
  await host.prepareForPrompt(new AbortController().signal);
  assert.equal(sessionStatus("docs", docs), undefined);
  transports.get("docs").drop();
  assert.equal(sessionStatus("docs", docs), undefined, "the close the host asked for is not recorded");

  // The session ends: the extension closes its connections, and a server that went down meanwhile is not news.
  const connected = sessionStatus("lint", lint);
  emit("session_shutdown");
  transports.get("lint").drop();
  const closed = sessionStatus("lint", lint);
  assert.equal(closed.state, "connected", "the last thing the session saw stays");
  assert.equal(typeof closed.closedAt, "number", "marked closed: nobody holds that connection any more");
  assert.deepEqual({ ...closed, closedAt: undefined }, { ...connected, closedAt: undefined });
});

test("a connection the host closes when it idles out is marked closed, and the next prompt's connection is not", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const docs = { command: "docs-srv" };
  const lint = { command: "lint-srv" };
  const { host, connect, transports } = setup({ servers: [entry("docs", docs), entry("lint", lint)], idleMs: 20 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  connect("lint");
  await transports.get("docs").handshake({});
  const failure = transports.get("lint");
  failure.stderr = "lint: no config\n";
  failure.drop();
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  assert.equal(sessionStatus("docs", docs).closedAt, undefined);
  const failed = sessionStatus("lint", lint);
  assert.equal(failed.state, "failed");

  await delay(50);
  const closed = sessionStatus("docs", docs);
  assert.equal(closed.state, "connected");
  assert.equal(typeof closed.closedAt, "number");
  // A failure is still true of the server once the host let go: it stays as it was.
  assert.equal(sessionStatus("lint", lint), failed);

  const again = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  connect("lint");
  assert.equal(sessionStatus("docs", docs).state, "connecting");
  await transports.get("docs").handshake({});
  await transports.get("lint").handshake({});
  await again;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  assert.equal(sessionStatus("docs", docs).state, "connected");
  assert.equal(sessionStatus("docs", docs).closedAt, undefined);
});

test("a session still holding an entry from before an edit never replaces what was recorded for the file as it is now", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const before = { command: "srv", args: ["--old"] };
  const after = { command: "srv", args: ["--new"] };
  const { host, config, connect, transports } = setup({ servers: [entry("docs", before)] });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  // Edited elsewhere (an editor, `pi mcp add`, git pull); this session syncs only at its next prompt.
  config.servers = [entry("docs", after)];
  const entryKey = { scope: "global", sourcePath: "/agent/global.json", name: "docs" };
  const tested = { origin: "test", state: "connected", tools: [], toolCount: 0, durationMs: 1, testedAt: Date.now() };
  recordMcpStatus(entryKey, mcpConfigKey(after), tested);
  // Its server for the old entry exits by itself.
  transports.get("docs").drop();
  assert.equal(host.serverStates()[0].state, "disconnected");
  assert.equal(sessionStatus("docs", after), tested, "the test of the entry as it is now still stands");
  assert.equal(sessionStatus("docs", before), undefined, "and the report about the old entry was dropped as stale");
});

test("a status is keyed by the entry as its file holds it, not by the config the host registered without a sandbox", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const docs = { command: "srv" };
  const { host, registered, connect, transports } = setup({ servers: [entry("docs", docs)], codemodeAvailable: false });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  // withReachableExposure() rewrote what was registered...
  assert.deepEqual(registered.get("docs"), { command: "srv", exposure: "deferred" });
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  // ...but Settings lists the entry under the key of its file's content.
  assert.equal(sessionStatus("docs", docs).state, "connected");
  assert.equal(sessionStatus("docs", { command: "srv", exposure: "deferred" }), undefined);
});

test("a name another extension registered first is a conflict that names it, recorded once while it lasts", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const taken = { command: "srv" };
  const { host, emit } = setup({
    servers: [entry("taken", taken)],
    pi: { getMcpServers: () => [{ name: "taken", config: { command: "theirs" }, extensionPath: "/ext/theirs.ts" }] },
  });
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(host.serverStates(), [{
    name: "taken",
    scope: "global",
    state: "not-registered",
    error: "MCP server \"taken\" is registered by /ext/other.ts",
    conflict: "/ext/theirs.ts",
  }]);
  const first = sessionStatus("taken", taken);
  assert.deepEqual({ state: first.state, conflict: first.conflict }, { state: "conflict", conflict: "/ext/theirs.ts" });
  // Every sync tries again and finds the same: the record is not rewritten.
  await host.prepareForPrompt(new AbortController().signal);
  assert.equal(sessionStatus("taken", taken), first);
  // The extension holding the name is that session's: once it ends, nothing says the name is taken.
  emit("session_shutdown");
  assert.equal(sessionStatus("taken", taken), undefined);

  // Without the registry, the SDK's own words name the owner.
  const { host: other } = setup({
    servers: [entry("docs", { command: "srv" })],
    pi: {
      registerMcpServer: () => {
        throw new Error("MCP server \"docs\" is already registered by extension \"/home/me/.pi/agent/extensions/docs.ts\"");
      },
    },
  });
  await other.prepareForPrompt(new AbortController().signal);
  assert.equal(other.serverStates()[0].conflict, "/home/me/.pi/agent/extensions/docs.ts");
  assert.equal(sessionStatus("docs", { command: "srv" }).state, "conflict");
});

test("a session whose /mcp is another extension's is recorded with that extension, until the session ends", (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  setup({ commands: [{ name: "mcp", sourceInfo: { path: "/ext/other-mcp.ts" } }] });
  const inactive = readMcpHostInactive("/project");
  assert.deepEqual({ owner: inactive.owner, cwd: inactive.cwd }, { owner: "/ext/other-mcp.ts", cwd: "/project" });
  assert.equal(readMcpHostInactive("/elsewhere"), inactive, "another folder hears of it too, naming the folder");

  const { emit } = setup({ commands: [{ name: "mcp", sourceInfo: { path: "/ext/other-mcp.ts" } }] });
  emit("session_shutdown");
  // Both fakes are one session id: the second replaced the first's record, and its end removed it.
  assert.equal(readMcpHostInactive("/project"), undefined);

  // Pi's own /mcp, and no /mcp at all (-builtin:mcp, which the files say), record nothing.
  setup();
  setup({ commands: [] });
  assert.equal(readMcpHostInactive(), undefined);
});

test("a host disposed as its session starts closing lets go of everything it reported, before any session_shutdown", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const docs = { command: "docs-srv" };
  const { host, connect, transports, emit, log } = setup({ servers: [entry("docs", docs), entry("taken", { command: "srv" })], promptWaitMs: 10 });
  const preparing = host.prepareForPrompt(new AbortController().signal);
  await delay(5);
  connect("docs");
  await transports.get("docs").handshake({});
  await preparing;
  // Other servers than `direct` ones are not waited for: their tools are ready a macrotask after they answer.
  await nextMacrotask();
  assert.equal(sessionStatus("docs", docs).closedAt, undefined);
  assert.equal(sessionStatus("taken", { command: "srv" }).state, "failed");

  // What the wrapper does first when it closes; the extensions' session_shutdown may never come.
  host.dispose();
  const closed = sessionStatus("docs", docs);
  assert.equal(closed.state, "connected");
  assert.equal(typeof closed.closedAt, "number");
  assert.equal(sessionStatus("taken", { command: "srv" }), undefined, "its problem records go too");
  // The extension then closes the connection: not a drop, and nothing is recorded.
  transports.get("docs").drop();
  assert.equal(sessionStatus("docs", docs), closed);
  // The host's own session_shutdown later repeats it harmlessly, and a late session_start records nothing.
  emit("session_shutdown");
  emit("session_start");
  assert.equal(sessionStatus("docs", docs), closed);
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, ["register docs"], "a disposed host registers nothing more");
});

test("a disposed host forgets that its session's /mcp is another extension's", (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const { host } = setup({ commands: [{ name: "mcp", sourceInfo: { path: "/ext/other-mcp.ts" } }] });
  assert.equal(readMcpHostInactive("/project")?.owner, "/ext/other-mcp.ts");
  host.dispose();
  assert.equal(readMcpHostInactive("/project"), undefined, "so no other folder hears of a session that is gone");
});

test("several extensions' /mcp name an owner too, and a prompt template named mcp does not", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  // pi names them mcp:1 and mcp:2 and drops the built-in, so nothing is registered either.
  const { host, log, emit } = setup({
    servers: [entry("docs", { command: "srv" })],
    commands: [
      { name: "mcp:1", source: "extension", sourceInfo: { path: "/ext/first-mcp.ts" } },
      { name: "mcp:2", source: "extension", sourceInfo: { path: "/ext/second-mcp.ts" } },
    ],
  });
  await host.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(log, []);
  assert.equal(readMcpHostInactive("/project").owner, "/ext/first-mcp.ts");
  emit("session_shutdown");

  // Under -builtin:mcp a template named mcp is all there is; the files say why the host is idle.
  setup({ commands: [{ name: "mcp", source: "prompt", sourceInfo: { path: "/project/.pi/prompts/mcp.md" } }] });
  assert.equal(readMcpHostInactive(), undefined);
  // Beside Pi's own /mcp it changes nothing.
  const { host: beside, log: besideLog } = setup({
    servers: [entry("docs", { command: "srv" })],
    commands: [{ name: "mcp", source: "prompt", sourceInfo: { path: "/p/mcp.md" } }, MCP_COMMAND],
    // Nothing connects here, so the prompt would wait the whole time.
    promptWaitMs: 10,
  });
  await beside.prepareForPrompt(new AbortController().signal);
  assert.deepEqual(besideLog, ["register docs"]);
  assert.equal(readMcpHostInactive(), undefined);
});

// ---------------------------------------------------------------------------
// Project trust, read from real files on every sync
// ---------------------------------------------------------------------------

/**
 * A host over real `mcp.json` files and a real `trust.json`, in a folder that
 * needed no trust when its session started. Every server the host registers
 * connects at once, so a sync never waits.
 */
async function trustFixture(t, { globalServers = { docs: { url: "https://docs.example/mcp" } }, beforeLoad } = {}) {
  const sdk = await loadPiSdkInternals();
  assert.equal(sdk.ok, true, sdk.reason);
  const internals = {
    loadMcpConfig(options) {
      beforeLoad?.(options);
      return sdk.loadMcpConfig(options);
    },
  };
  const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-trust-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const parent = join(root, "work");
  const cwd = join(parent, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(agentDir, "mcp.json"), JSON.stringify({ mcpServers: globalServers }));

  const handlers = new Map();
  const log = [];
  const registered = new Map();
  let factory;
  const pi = {
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getCommands: () => [MCP_COMMAND],
    registerMcpServer(name, config) {
      registered.set(name, config);
      log.push(`register ${name}`);
      // The extension opens the connection and the server answers.
      void factory({ name, config, source: "<inline:pi-web-mcp-host>", scope: "extension" }, cwd, undefined).handshake({});
    },
    unregisterMcpServer(name) {
      registered.delete(name);
      log.push(`unregister ${name}`);
    },
  };
  // No mayReadProjectConfig option: the host reads the folder and trust.json itself.
  const host = new McpHost({ agentDir, internals, codemodeAvailable: () => true, promptWaitMs: 2_000, idleMs: 0 });
  host.extension().factory(pi);
  factory = host.wrapTransportFactory(() => new FakeTransport());
  // What a wrapper built for a folder that needed no trust reports for the rest of its life.
  const ctx = { cwd, isProjectTrusted: () => true, isIdle: () => true, sessionManager: { getSessionId: () => "trust-session" } };
  for (const handler of handlers.get("session_start") ?? []) handler({ type: "session_start" }, ctx);

  return {
    agentDir,
    parent,
    cwd,
    host,
    log,
    registered,
    trust: new ProjectTrustStore(agentDir),
    // The servers answer at once, but a prompt waits only for `direct` ones: give the others their macrotask.
    prompt: async () => {
      await host.prepareForPrompt(new AbortController().signal);
      await delay(5);
    },
    async writeProjectServers(servers) {
      await mkdir(join(cwd, ".pi"), { recursive: true });
      await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: servers }));
    },
  };
}

test("a project's mcp.json that appears after the session started connects only once the project is trusted", async (t) => {
  const { cwd, host, log, registered, trust, prompt, writeProjectServers } = await trustFixture(t);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);

  // git pull, `pi mcp add -l`, or the model's write tool: the folder now requires trust.
  await writeProjectServers({ repo: { command: "repo-srv" } });
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"], "the wrapper's stale snapshot does not count");
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "ready" },
    { name: "repo", scope: "project", state: "not-trusted" },
  ]);

  trust.set(cwd, true);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "ready" },
    { name: "repo", scope: "project", state: "ready" },
  ]);

  // Revoked anywhere, the CLI included: the server goes at the next prompt.
  trust.set(cwd, false);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  assert.deepEqual(host.serverStates().map((server) => `${server.name}:${server.state}`), ["docs:ready", "repo:not-trusted"]);
  assert.deepEqual(log, ["register docs", "register repo", "unregister repo"], "the global server is left alone");
});

test("trust inherited from a parent folder connects a project's servers, and an exact false beneath it does not", async (t) => {
  const { cwd, parent, log, registered, trust, prompt, writeProjectServers } = await trustFixture(t);
  await writeProjectServers({ repo: { command: "repo-srv" } });
  trust.set(parent, true);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);

  trust.set(cwd, false);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  assert.deepEqual(log, ["register docs", "register repo", "unregister repo"]);
});

test("an untrusted project entry named like a global one leaves the global one connected", async (t) => {
  const { host, registered, prompt, writeProjectServers } = await trustFixture(t);
  await writeProjectServers({ docs: { command: "repo-docs" } });
  await prompt();
  assert.deepEqual(registered.get("docs"), { url: "https://docs.example/mcp" });
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "ready" },
    { name: "docs", scope: "project", state: "not-trusted" },
  ]);
});

test("an unreadable trust.json counts as untrusted, with one warning", async (t) => {
  const { agentDir, cwd, registered, trust, prompt, writeProjectServers } = await trustFixture(t);
  await writeProjectServers({ repo: { command: "repo-srv" } });
  trust.set(cwd, true);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);

  const warn = t.mock.method(console, "warn", () => {});
  await writeFile(join(agentDir, "trust.json"), "{ not json");
  await prompt();
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  const trustWarnings = warn.mock.calls.filter((call) => String(call.arguments[0]).includes("project trust"));
  assert.equal(trustWarnings.length, 1);
  assert.match(String(trustWarnings[0].arguments[0]), /trust\.json/);
});

test("a trust.json still locked by another process counts as untrusted", async (t) => {
  const { agentDir, cwd, log, registered, trust, prompt, writeProjectServers } = await trustFixture(t);
  await writeProjectServers({ repo: { command: "repo-srv" } });
  trust.set(cwd, true);
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs", "repo"]);

  const warn = t.mock.method(console, "warn", () => {});
  // proper-lockfile's lock is a directory beside the file; a fresh one is never stale.
  const lock = join(agentDir, "trust.json.lock");
  await mkdir(lock);
  t.after(() => rm(lock, { recursive: true, force: true }));
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  assert.deepEqual(log, ["register docs", "register repo", "unregister repo"], "the global server is left alone");
  const trustWarnings = warn.mock.calls.filter((call) => String(call.arguments[0]).includes("project trust"));
  assert.equal(trustWarnings.length, 1);
  assert.match(String(trustWarnings[0].arguments[0]), /trust\.json/);
});

test("a project's mcp.json that lands between the trust read and the SDK's read is not read", async (t) => {
  // The folder needs no trust when its trust is read; the file lands before the SDK opens it.
  let land;
  const { host, registered, prompt } = await trustFixture(t, { beforeLoad: (options) => land?.(options) });
  land = ({ cwd }) => {
    land = undefined;
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { repo: { command: "repo-srv" } } }));
  };
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  // Reported at once: the names are read after the SDK's read.
  assert.deepEqual(host.serverStates(), [
    { name: "docs", scope: "global", state: "ready" },
    { name: "repo", scope: "project", state: "not-trusted" },
  ]);
});

test("what a session saw reaches the listing: a connected global server, then an untrusted project entry until it is trusted", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const { agentDir, cwd, prompt, trust, writeProjectServers } = await trustFixture(t);
  await writeProjectServers({ repo: { command: "repo-srv" } });
  await prompt();
  await nextMacrotask();
  // As Settings › MCP lists them: GET attaches a record only while its key matches the file.
  const listed = async () => {
    const { servers } = await readMcpOverview({ agentDir, project: { cwd, allowedRoots: new Set([cwd]) } });
    return Object.fromEntries(servers.map((server) => [`${server.scope}:${server.name}`, server.status]));
  };
  const before = await listed();
  assert.deepEqual(
    { origin: before["global:docs"].origin, state: before["global:docs"].state, sessionId: before["global:docs"].sessionId, cwd: before["global:docs"].cwd },
    { origin: "session", state: "connected", sessionId: "trust-session", cwd },
  );
  assert.equal(before["project:repo"].state, "not-trusted");
  // Found again at the next sync: not rewritten.
  const recorded = readMcpStatus({ scope: "project", sourcePath: join(cwd, ".pi", "mcp.json"), name: "repo" }, mcpConfigKey({ command: "repo-srv" }));
  await prompt();
  assert.equal(readMcpStatus({ scope: "project", sourcePath: join(cwd, ".pi", "mcp.json"), name: "repo" }, mcpConfigKey({ command: "repo-srv" })), recorded);

  trust.set(cwd, true);
  await prompt();
  await nextMacrotask();
  assert.equal((await listed())["project:repo"].state, "connected");
  assert.equal(mcpStatusCount(), 2);
});

test("an untrusted project's entries are read with their values, only to key their status", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-entries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".pi"));
  await writeFile(join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { a: { command: "x", env: { TOKEN: "!touch marker" } }, b: 1 } }));
  assert.deepEqual(untrustedProjectServerEntries(root), [["a", { command: "x", env: { TOKEN: "!touch marker" } }], ["b", 1]]);
  assert.deepEqual(untrustedProjectServerNames(root), ["a", "b"]);
});

test("mcp.json errors are logged once each instead of dropped", async (t) => {
  const { registered, prompt } = await trustFixture(t, {
    globalServers: { docs: { url: "https://docs.example/mcp" }, broken: { url: "ftp://docs.example" } },
  });
  const warn = t.mock.method(console, "warn", () => {});
  await prompt();
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  const configWarnings = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("MCP config"));
  assert.equal(configWarnings.length, 1);
  assert.match(configWarnings[0], /mcp\.json: server "broken": url must be an http or https URL/);
});

test("a parse error is logged without the part of mcp.json it quotes", async (t) => {
  const { agentDir, registered, prompt } = await trustFixture(t);
  // A single-quoted value, the usual mistake: V8 quotes the text around the quote.
  await writeFile(join(agentDir, "mcp.json"), `{"mcpServers":{"gh":{"command":"npx","env":{"GITHUB_TOKEN":'ghp_SECRETabcdefghijklmnop1234'}}}}`);
  const warn = t.mock.method(console, "warn", () => {});
  await prompt();
  assert.deepEqual([...registered.keys()], []);
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("MCP config"));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(join(agentDir, "mcp.json")), lines[0]);
  assert.match(lines[0], /Unexpected token ''' in JSON/);
  assert.doesNotMatch(lines[0], /ghp_|TOKEN/);
});

test("a file with many broken entries logs a few of them and a count, once", async (t) => {
  const broken = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`b${index}`, { url: `ftp://docs.example/${index}` }]));
  const { registered, prompt } = await trustFixture(t, { globalServers: { docs: { url: "https://docs.example/mcp" }, ...broken } });
  const warn = t.mock.method(console, "warn", () => {});
  await prompt();
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("MCP config"));
  assert.equal(lines.length, 21);
  assert.match(lines.at(-1), /10 more errors in mcp\.json are not logged/);
});

/** `levels` arrays around `"x"` as JSON text: JSON.stringify recurses once per level, and overflows a smaller stack (Linux CI runners). */
function nestedArraysJson(levels) {
  return `${"[".repeat(levels)}"x"${"]".repeat(levels)}`;
}

test("an untrusted project's entry nested thousands of levels deep stops neither the global servers nor the other reports", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const { agentDir, cwd, host, registered, prompt } = await trustFixture(t);
  // 6 KB of brackets: hashing it recursed once per level and overflowed the stack.
  const deep = nestedArraysJson(5_000);
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(join(cwd, ".pi", "mcp.json"), `{"mcpServers":{"evil":{"command":"x","pad":${deep}},"hide":${deep},"repo":{"command":"repo-srv"}}}`);
  t.mock.method(console, "error", () => {});
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  assert.deepEqual(host.serverStates().map((server) => `${server.scope}:${server.name}:${server.state}`), [
    "global:docs:ready",
    "project:evil:not-trusted",
    "project:hide:not-trusted",
    "project:repo:not-trusted",
  ]);
  // Settings and the trust dialog list the file as the host saw it.
  const { servers, files } = await readMcpOverview({ agentDir, project: { cwd, allowedRoots: new Set([cwd]) } });
  assert.deepEqual(files.map((file) => file.problems), [[], []]);
  assert.deepEqual(servers.map((server) => `${server.scope}:${server.name}`), ["global:docs", "project:evil", "project:hide", "project:repo"]);
  assert.match(servers.find((server) => server.name === "hide").invalidError, /hide/);
});

test("an untrusted project declaring hundreds of servers reports only the first hundred, and keeps everyone else's records", async (t) => {
  clearMcpStatuses();
  t.after(clearMcpStatuses);
  const { host, registered, prompt, writeProjectServers } = await trustFixture(t);
  const kept = { scope: "global", sourcePath: "/elsewhere/mcp.json", name: "kept" };
  const tested = { origin: "test", state: "connected", testedAt: Date.now() };
  recordMcpStatus(kept, mcpConfigKey({ command: "kept" }), tested);
  await writeProjectServers(Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`s${index}`, { command: "x" }])));
  const warn = t.mock.method(console, "warn", () => {});
  await prompt();
  await prompt();
  assert.deepEqual([...registered.keys()], ["docs"]);
  assert.equal(host.serverStates().filter((server) => server.state === "not-trusted").length, 100);
  assert.ok(mcpStatusCount() <= 102, String(mcpStatusCount()));
  assert.equal(readMcpStatus(kept, mcpConfigKey({ command: "kept" })), tested, "a Test of another entry is not evicted");
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("MCP config"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /500 more servers of this untrusted project are not reported/);
});

test("an untrusted project's server names are read only from a regular file inside the project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-host-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = (name) => join(root, name);
  const configPath = (name) => join(root, name, ".pi", "mcp.json");
  for (const name of ["plain", "shapeless", "huge", "inside-link", "outside-link", "folder", "fifo"]) {
    await mkdir(join(project(name), ".pi"), { recursive: true });
  }

  await writeFile(configPath("plain"), JSON.stringify({ mcpServers: { a: { command: "x" }, "b c": 1 } }));
  assert.deepEqual(untrustedProjectServerNames(project("plain")), ["a", "b c"], "names only, nothing validated");
  assert.deepEqual(untrustedProjectServerNames(project("missing")), []);

  await writeFile(configPath("shapeless"), JSON.stringify({ mcpServers: ["a"] }));
  assert.deepEqual(untrustedProjectServerNames(project("shapeless")), []);

  await writeFile(configPath("huge"), JSON.stringify({ mcpServers: { a: {} }, pad: "x".repeat(1024 * 1024) }));
  assert.deepEqual(untrustedProjectServerNames(project("huge")), []);

  await mkdir(configPath("folder"));
  assert.deepEqual(untrustedProjectServerNames(project("folder")), []);

  try {
    await writeFile(join(project("inside-link"), "servers.json"), JSON.stringify({ mcpServers: { linked: {} } }));
    await symlink(join(project("inside-link"), "servers.json"), configPath("inside-link"), "file");
    await writeFile(join(root, "elsewhere.json"), JSON.stringify({ mcpServers: { secret: {} } }));
    await symlink(join(root, "elsewhere.json"), configPath("outside-link"), "file");
  } catch (error) {
    if (process.platform === "win32" && error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return;
    }
    throw error;
  }
  assert.deepEqual(untrustedProjectServerNames(project("inside-link")), ["linked"]);
  assert.deepEqual(untrustedProjectServerNames(project("outside-link")), [], "a repository's link never reads a file elsewhere");

  if (process.platform !== "win32") {
    // Opening a FIFO for reading would block until something writes to it.
    execFileSync("mkfifo", [configPath("fifo")]);
    assert.deepEqual(untrustedProjectServerNames(project("fifo")), []);
  }
});
